import { UnrecoverableError, type Job } from 'bullmq';
import {
  aiJobs,
  aiOutputs,
  audit,
  documents,
  documentTexts,
  documentVersions,
  userCanAccessMatter,
  type AiJobDoc,
} from '@assar/database';
import type { StorageService } from '@assar/storage';
import type { AiTask } from '@assar/types';
import { describeError, JobFailure } from './errors.js';
import { buildCaseFile } from './case-file.js';
import { extractText, readCapped } from './extract.js';
import type { GrokClient } from './grok.js';
import type { AiJobData, EventSink, JobLogger } from './names.js';
import { buildPrompt, type Source } from './prompts.js';
import { parseModelOutput, verifyOutput } from './verify.js';

export interface AiProcessorDeps {
  grok: GrokClient;
  storage: StorageService;
  logger: JobLogger;
  /** Total characters of source text sent to the model; split evenly across sources. */
  maxContextChars: number;
  maxExtractBytes: number;
  /** Development only: allow versions marked `skipped` (scanner disabled). */
  allowUnscanned: boolean;
  /** Optional: announces `ai.output_ready` to workflows. */
  events?: EventSink;
}

type JobRecord = NonNullable<Awaited<ReturnType<typeof aiJobs.findById>>>;
const TERMINAL = ['succeeded', 'failed', 'cancelled'];
const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

/**
 * Runs one AI job. Status fields are written only as the work genuinely happens
 * (queued → processing[stage] → succeeded/failed/cancelled); there is no estimated progress.
 * Output is saved as an unverified DRAFT and stays that way until a person approves it through the API.
 */
export function createAiProcessor(deps: AiProcessorDeps) {
  const stage = (org: string, id: string, s: string) => aiJobs.patch(org, id, { stage: s });

  async function cancelled(org: string, id: string) {
    await aiJobs.transition(org, id, ['queued', 'processing'], {
      status: 'cancelled',
      stage: null,
      finishedAt: new Date(),
    });
    await audit.record({
      organizationId: org,
      actorId: null,
      action: 'ai.job_cancelled',
      targetType: 'ai_job',
      targetId: id,
    } as never);
  }

  async function loadSources(rec: JobRecord): Promise<Source[]> {
    const org = String(rec.organizationId);
    const budget = Math.floor(deps.maxContextChars / Math.max(rec.documents.length, 1));
    const sources: Source[] = [];
    for (const [i, ref] of rec.documents.entries()) {
      const doc = await documents.findById(org, ref.documentId);
      if (!doc || doc.status !== 'active' || String(doc.matterId) !== String(rec.matterId)) {
        throw new JobFailure(
          'A selected document is no longer available',
          'SOURCE_UNAVAILABLE',
          false,
        );
      }
      const v = await documentVersions.find(org, doc._id, ref.version);
      const usable = v && (v.status === 'clean' || (v.status === 'skipped' && deps.allowUnscanned));
      if (!v || !usable)
        throw new JobFailure(
          'A selected document version is not available for analysis',
          'SOURCE_UNAVAILABLE',
          false,
        );
      if (!(await deps.storage.head(v.storageKey)))
        throw new JobFailure(
          'A selected document file is missing from storage',
          'SOURCE_UNAVAILABLE',
          false,
        );

      // Prefer the text already read at upload time (it includes OCR for scans); otherwise read it now.
      const stored = await documentTexts.find(org, v._id);
      const text =
        stored?.status === 'done' && stored.text
          ? stored.text
          : await extractText(
              await readCapped(await deps.storage.read(v.storageKey), deps.maxExtractBytes),
              v.contentType,
            );
      const truncated = text.length > budget;
      sources.push({
        id: `S${i + 1}`,
        documentId: String(doc._id),
        version: v.version,
        title: doc.title,
        filename: v.filename,
        text: truncated ? text.slice(0, budget) : text,
        truncated,
      });
    }
    return sources;
  }

  async function run(rec: JobRecord): Promise<boolean> {
    const org = String(rec.organizationId);
    const id = String(rec._id);

    // Access may have changed while the job waited in the queue.
    if (rec.matterId && !(await userCanAccessMatter(org, rec.matterId, rec.requestedBy))) {
      throw new JobFailure(
        'The requester no longer has access to this matter',
        'ACCESS_REVOKED',
        false,
      );
    }
    const wasCancelled = async () => (await aiJobs.findById(org, id))?.cancelRequested === true;

    let sources: Source[];
    if (rec.clientId) {
      // Client-level: the only source is the generated case file, limited to what the requester may see.
      const file = await buildCaseFile(
        org,
        String(rec.clientId),
        String(rec.requestedBy),
        deps.maxContextChars,
      );
      sources = [
        {
          id: 'S1',
          documentId: null,
          version: 1,
          title: 'Client case file',
          filename: 'case-file.txt',
          text: file.text,
          truncated: file.truncated,
        },
      ];
    } else {
      sources = await loadSources(rec);
    }
    if (await wasCancelled()) return false;

    await stage(org, id, 'generating');
    const prompt = buildPrompt(rec.task as AiTask, sources, rec.instructions);
    const completion = await deps.grok.completeJson(prompt);
    const result = verifyOutput(rec.task as AiTask, parseModelOutput(completion.content), sources);

    await stage(org, id, 'saving');
    if (await wasCancelled()) return false;

    let output;
    try {
      output = await aiOutputs.create({
        organizationId: rec.organizationId,
        matterId: rec.matterId ?? null,
        clientId: rec.clientId ?? null,
        jobId: rec._id,
        task: rec.task,
        requestedBy: rec.requestedBy,
        result: result as unknown as Record<string, unknown>,
        sources: sources.map((s) => ({
          sourceId: s.id,
          documentId: (s.documentId ?? null) as never,
          version: s.version,
          filename: s.filename,
          title: s.title,
          chars: s.text.length,
          truncated: s.truncated,
        })),
        reviewStatus: 'draft',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        editedText: null,
        editedBy: null,
        editedAt: null,
        model: completion.model,
      });
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      output = await aiOutputs.findByJob(org, id); // a previous attempt saved it before crashing
      if (!output) throw e;
    }
    await aiJobs.transition(org, id, ['processing'], {
      status: 'succeeded',
      stage: null,
      error: null,
      model: completion.model,
      usage: completion.usage,
      outputId: output._id,
      finishedAt: new Date(),
    });
    await audit.record({
      organizationId: org,
      actorId: null,
      action: 'ai.job_succeeded',
      targetType: 'ai_job',
      targetId: id,
      // Metadata only: never prompts, answers or document text.
      meta: {
        task: rec.task,
        outputId: String(output._id),
        verification: result.verification.status,
        sources: sources.length,
      },
    } as never);
    // Client-level summaries are private to the requester; workflows only hear about matter-scoped output.
    if (rec.matterId)
      await deps.events
        ?.publish({
          event: 'ai.output_ready',
          organizationId: org,
          data: {
            outputId: String(output._id),
            jobId: id,
            matterId: String(rec.matterId),
            requestedBy: String(rec.requestedBy),
            task: rec.task,
          },
        })
        .catch((e: Error) =>
          deps.logger.warn({ error: e.message }, 'could not publish ai.output_ready'),
        );
    return true;
  }

  return async (job: Job<AiJobData>): Promise<void> => {
    const { organizationId: org, aiJobId: id } = job.data;
    const rec = await aiJobs.findById(org, id);
    if (!rec) throw new UnrecoverableError('AI job record not found');
    if (TERMINAL.includes(rec.status)) return; // redelivered after completion: nothing to do
    if (rec.cancelRequested) return void (await cancelled(org, id));

    const started = (await aiJobs.transition(org, id, ['queued', 'processing'], {
      $set: {
        status: 'processing',
        stage: 'extracting_text',
        startedAt: rec.startedAt ?? new Date(),
      },
      $inc: { attempts: 1 },
    })) as AiJobDoc | null;
    if (!started) return;

    try {
      if (!(await run(started as JobRecord))) await cancelled(org, id);
    } catch (e) {
      const d = describeError(e);
      const isLast = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      deps.logger.warn(
        {
          aiJobId: id,
          code: d.code,
          retryable: d.retryable,
          attempt: job.attemptsMade + 1,
          final: isLast,
        },
        'ai job attempt failed',
      );
      if (!d.retryable || isLast) {
        await aiJobs.transition(org, id, ['queued', 'processing'], {
          status: 'failed',
          stage: null,
          finishedAt: new Date(),
          error: d,
        });
        await audit.record({
          organizationId: org,
          actorId: null,
          action: 'ai.job_failed',
          targetType: 'ai_job',
          targetId: id,
          meta: { code: d.code, attempts: job.attemptsMade + 1 },
        } as never);
        throw new UnrecoverableError(d.message);
      }
      // Back to queued with the reason visible while BullMQ waits to retry.
      await aiJobs.transition(org, id, ['processing'], { status: 'queued', stage: null, error: d });
      throw e;
    }
  };
}
