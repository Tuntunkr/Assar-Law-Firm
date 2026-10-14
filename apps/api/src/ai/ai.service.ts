import { Inject, Injectable } from '@nestjs/common';
import {
  aiJobs,
  aiOutputs,
  documents,
  documentVersions,
  type AiJobDoc,
  type AiOutputDoc,
} from '@assar/database';
import type { JobQueues } from '@assar/jobs';
import { hasPermission } from '@assar/types';
import type { z } from 'zod';
import type {
  aiJobListQuerySchema,
  aiOutputListQuerySchema,
  approveAiOutputSchema,
  createAiJobSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { ENV, type Env } from '../config/env';
import { MatterAccessService } from '../matters/matter-access.service';
import { QUEUES } from '../queue/queue.module';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const idStr = (v: unknown) => (v == null ? null : String(v));

export const jobDto = (j: AiJobDoc) => ({
  id: String(j._id),
  matterId: String(j.matterId),
  task: j.task,
  status: j.status,
  /** What the worker is really doing right now (null unless processing). Not a progress estimate. */
  stage: j.stage ?? null,
  attempts: j.attempts,
  maxAttempts: j.maxAttempts,
  error: j.error ?? null,
  cancelRequested: j.cancelRequested,
  documents: j.documents.map((d) => ({ documentId: String(d.documentId), version: d.version })),
  requestedBy: String(j.requestedBy),
  model: j.model ?? null,
  usage: j.usage ?? null,
  outputId: idStr(j.outputId),
  createdAt: j.createdAt,
  startedAt: j.startedAt ?? null,
  finishedAt: j.finishedAt ?? null,
});

const LABELS = {
  draft: 'AI-generated DRAFT — unverified. A lawyer must review it before use. Not legal advice.',
  approved: 'AI-generated content approved by a reviewer. Verify before relying on it.',
  rejected: 'AI-generated content rejected by a reviewer. Do not use.',
} as const;

export const outputDto = (o: AiOutputDoc) => ({
  id: String(o._id),
  jobId: String(o.jobId),
  matterId: String(o.matterId),
  task: o.task,
  /** Always true: nothing here is human-authored unless `editedText` says so. */
  aiGenerated: true,
  reviewStatus: o.reviewStatus,
  label: LABELS[o.reviewStatus],
  result: o.result,
  sources: o.sources,
  editedText: o.editedText ?? null,
  editedBy: idStr(o.editedBy),
  editedAt: o.editedAt ?? null,
  reviewedBy: idStr(o.reviewedBy),
  reviewedAt: o.reviewedAt ?? null,
  reviewNote: o.reviewNote ?? null,
  model: o.model,
  createdAt: o.createdAt,
});

@Injectable()
export class AiService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(QUEUES) private readonly queues: JobQueues,
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
  ) {}

  private ensureEnabled() {
    if (!this.env.AI_ENABLED)
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'AI features are not enabled');
  }

  // ---- jobs ----

  async create(auth: AuthContext, input: z.infer<typeof createAiJobSchema>, req: Req) {
    this.ensureEnabled();
    const orgId = auth.organizationId;
    await this.access.load(auth, input.matterId, req);

    // Pin each source to an exact, scanned version so results are reproducible and reviewable.
    const pinned: { documentId: string; version: number }[] = [];
    for (const ref of input.documents) {
      const doc = await documents.findById(orgId, ref.documentId);
      if (!doc || doc.status !== 'active' || String(doc.matterId) !== input.matterId) {
        throw new ApiError(
          400,
          'VALIDATION_FAILED',
          'A selected document does not belong to this matter',
        );
      }
      const versions = await documentVersions.listForDocument(orgId, doc._id);
      const usable = (status: string) =>
        status === 'clean' ||
        (status === 'skipped' &&
          this.env.SCAN_PROVIDER === 'disabled' &&
          this.env.NODE_ENV !== 'production');
      const chosen = ref.version
        ? versions.find((v) => v.version === ref.version)
        : versions.find((v) => usable(v.status));
      if (!chosen)
        throw new ApiError(
          400,
          'VALIDATION_FAILED',
          ref.version
            ? 'A selected document version does not exist'
            : 'A selected document has no scanned version yet',
        );
      if (!usable(chosen.status))
        throw new ApiError(
          409,
          'CONFLICT',
          'A selected document version has not passed the security scan',
        );
      pinned.push({ documentId: String(doc._id), version: chosen.version });
    }

    if ((await aiJobs.countActive(orgId)) >= this.env.AI_MAX_ACTIVE_JOBS_PER_ORG) {
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Too many AI jobs are already in progress. Wait for one to finish.',
      );
    }

    const job = await aiJobs.create({
      organizationId: orgId as never,
      matterId: input.matterId as never,
      requestedBy: auth.userId as never,
      task: input.task,
      documents: pinned as never,
      instructions: input.instructions,
      status: 'queued',
      attempts: 0,
      maxAttempts: this.env.AI_JOB_MAX_ATTEMPTS,
      runNumber: 1,
      cancelRequested: false,
    });
    await this.enqueueOrFail(job);
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'ai.job_created',
      targetType: 'ai_job',
      targetId: String(job._id),
      req,
      meta: { task: input.task, matterId: input.matterId, documents: pinned.length },
    });
    return jobDto(job);
  }

  /** If the queue is down the job is failed immediately rather than left "queued" forever. */
  private async enqueueOrFail(job: AiJobDoc) {
    try {
      await this.queues.enqueueAi(
        { organizationId: String(job.organizationId), aiJobId: String(job._id) },
        job.runNumber,
        job.maxAttempts,
      );
    } catch {
      await aiJobs.transition(job.organizationId, job._id, ['queued'], {
        status: 'failed',
        finishedAt: new Date(),
        error: {
          code: 'QUEUE_UNAVAILABLE',
          message: 'The job could not be queued',
          retryable: true,
        },
      });
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'The processing queue is unavailable. Please try again shortly.',
      );
    }
  }

  private async loadJob(auth: AuthContext, id: string, req: Req) {
    const job = await aiJobs.findById(auth.organizationId, id);
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'AI job not found');
    await this.access.loadFor(auth, String(job.matterId), req, 'AI job not found');
    return job;
  }

  async list(auth: AuthContext, q: z.infer<typeof aiJobListQuerySchema>, req: Req) {
    if (q.matterId) await this.access.load(auth, q.matterId, req);
    const hiddenMatterIds = q.matterId ? [] : await this.access.hiddenMatterIds(auth);
    const page = await aiJobs.listPage(auth.organizationId, { ...q, hiddenMatterIds });
    return { data: page.data.map(jobDto), page: page.page };
  }

  async get(auth: AuthContext, id: string, req: Req) {
    return jobDto(await this.loadJob(auth, id, req));
  }

  async cancel(auth: AuthContext, id: string, req: Req) {
    const job = await this.loadJob(auth, id, req);
    if (String(job.requestedBy) !== auth.userId && !hasPermission(auth.role, 'user:manage')) {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Only the requester or an administrator can cancel this job',
      );
    }
    if (job.status !== 'queued' && job.status !== 'processing')
      throw new ApiError(409, 'CONFLICT', `A ${job.status} job cannot be cancelled`);

    let result: AiJobDoc | null;
    const removed =
      job.status === 'queued' && (await this.queues.removeWaitingAi(id, job.runNumber));
    if (removed) {
      result = await aiJobs.transition(auth.organizationId, id, ['queued'], {
        status: 'cancelled',
        stage: null,
        finishedAt: new Date(),
      });
    } else {
      // Already running: ask the worker to stop at its next checkpoint. It reports the real outcome.
      result = await aiJobs.patch(auth.organizationId, id, { cancelRequested: true });
    }
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'ai.job_cancel_requested',
      targetType: 'ai_job',
      targetId: id,
      req,
    });
    return jobDto(result ?? job);
  }

  async retry(auth: AuthContext, id: string, req: Req) {
    this.ensureEnabled();
    const job = await this.loadJob(auth, id, req);
    if (job.status !== 'failed')
      throw new ApiError(409, 'CONFLICT', 'Only failed jobs can be retried');
    if (String(job.requestedBy) !== auth.userId && !hasPermission(auth.role, 'user:manage')) {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Only the requester or an administrator can retry this job',
      );
    }
    if ((await aiJobs.countActive(auth.organizationId)) >= this.env.AI_MAX_ACTIVE_JOBS_PER_ORG) {
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Too many AI jobs are already in progress. Wait for one to finish.',
      );
    }
    const reset = (await aiJobs.transition(auth.organizationId, id, ['failed'], {
      $set: {
        status: 'queued',
        stage: null,
        attempts: 0,
        error: null,
        cancelRequested: false,
        startedAt: null,
        finishedAt: null,
      },
      $inc: { runNumber: 1 },
    })) as AiJobDoc | null;
    if (!reset) throw new ApiError(409, 'CONFLICT', 'Only failed jobs can be retried');
    await this.enqueueOrFail(reset);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'ai.job_retried',
      targetType: 'ai_job',
      targetId: id,
      req,
    });
    return jobDto(reset);
  }

  // ---- outputs ----

  private async loadOutput(auth: AuthContext, id: string, req: Req) {
    const out = await aiOutputs.findById(auth.organizationId, id);
    if (!out) throw new ApiError(404, 'NOT_FOUND', 'AI output not found');
    await this.access.loadFor(auth, String(out.matterId), req, 'AI output not found');
    return out;
  }

  async listOutputs(auth: AuthContext, q: z.infer<typeof aiOutputListQuerySchema>, req: Req) {
    if (q.matterId) await this.access.load(auth, q.matterId, req);
    const hiddenMatterIds = q.matterId ? [] : await this.access.hiddenMatterIds(auth);
    const page = await aiOutputs.listPage(auth.organizationId, { ...q, hiddenMatterIds });
    return { data: page.data.map(outputDto), page: page.page };
  }

  async getOutput(auth: AuthContext, id: string, req: Req) {
    return outputDto(await this.loadOutput(auth, id, req));
  }

  async edit(auth: AuthContext, id: string, text: string, req: Req) {
    await this.loadOutput(auth, id, req);
    const out = await aiOutputs.saveEdit(auth.organizationId, id, text, auth.userId);
    if (!out) throw new ApiError(409, 'CONFLICT', 'Only drafts can be edited');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'ai.output_edited',
      targetType: 'ai_output',
      targetId: id,
      req,
    });
    return outputDto(out);
  }

  async approve(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof approveAiOutputSchema>,
    req: Req,
  ) {
    const out = await this.loadOutput(auth, id, req);
    const v = (
      out.result as { verification?: { status?: string; unsupportedAuthorities?: string[] } }
    ).verification;
    const needsAck = v?.status !== 'all_verified' || (v?.unsupportedAuthorities?.length ?? 0) > 0;
    if (needsAck && !input.acknowledgeUnverified) {
      throw new ApiError(
        409,
        'CONFLICT',
        'This draft contains items that could not be verified against the sources. Review them and confirm with acknowledgeUnverified.',
      );
    }
    const approved = await aiOutputs.review(
      auth.organizationId,
      id,
      'approved',
      auth.userId,
      input.note ?? null,
    );
    if (!approved) throw new ApiError(409, 'CONFLICT', 'This output has already been reviewed');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'ai.output_approved',
      targetType: 'ai_output',
      targetId: id,
      req,
      meta: { acknowledgedUnverified: needsAck, task: out.task },
    });
    return outputDto(approved);
  }

  async reject(auth: AuthContext, id: string, reason: string, req: Req) {
    await this.loadOutput(auth, id, req);
    const rejected = await aiOutputs.review(
      auth.organizationId,
      id,
      'rejected',
      auth.userId,
      reason,
    );
    if (!rejected) throw new ApiError(409, 'CONFLICT', 'This output has already been reviewed');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'ai.output_rejected',
      targetType: 'ai_output',
      targetId: id,
      req,
    });
    return outputDto(rejected);
  }
}
