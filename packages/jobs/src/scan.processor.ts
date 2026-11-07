import { UnrecoverableError, type Job } from 'bullmq';
import { audit, documentVersions, type DocumentVersionDoc } from '@assar/database';
import type { ScanProvider, StorageService } from '@assar/storage';
import type { EventSink, ExtractJobData, JobLogger, ScanJobData } from './names.js';

export interface ScanProcessorDeps {
  storage: StorageService;
  provider: ScanProvider;
  logger: JobLogger;
  /** Optional: announces `document.scan_clean` to workflows. */
  events?: EventSink;
  /** Optional: asks for the text of a version that passed (or, in development, skipped) the scan. */
  requestExtract?: (data: ExtractJobData) => Promise<unknown>;
}

const entry = (
  v: Pick<DocumentVersionDoc, 'organizationId' | '_id' | 'documentId' | 'version'>,
  action: string,
  meta: object = {},
) => ({
  organizationId: v.organizationId,
  actorId: null,
  action,
  targetType: 'document_version',
  targetId: String(v._id),
  meta: { documentId: String(v.documentId), version: v.version, ...meta },
});

/**
 * Scans an uploaded version. The version stays `scanning` (a real state) while BullMQ retries
 * transient failures such as the scanner being down; only after the last attempt is it `scan_failed`.
 */
export function createScanProcessor(deps: ScanProcessorDeps) {
  return async (job: Job<ScanJobData>): Promise<void> => {
    const { organizationId: org, versionId } = job.data;
    const v = await documentVersions.findById(org, versionId);
    if (!v || v.status !== 'scanning') return; // already handled or gone: nothing to do

    try {
      const outcome = await deps.provider.scan(await deps.storage.read(v.storageKey));
      const scan = {
        engine: outcome.engine,
        result: outcome.status === 'infected' ? outcome.signature : outcome.status,
        scannedAt: new Date(),
      };
      const updated = await documentVersions.transition(org, v._id, ['scanning'], {
        status: outcome.status,
        scan,
      });
      if (!updated) return;
      if (outcome.status === 'infected') await deps.storage.delete(v.storageKey); // never keep infected content
      await audit.record(
        entry(v, `document.scan_${outcome.status}`, { engine: outcome.engine }) as never,
      );
      if (outcome.status === 'clean' || outcome.status === 'skipped') {
        // Best effort: reading the text must never fail or retry the scan itself.
        await deps
          .requestExtract?.({ organizationId: String(org), versionId: String(v._id) })
          .catch((e: Error) =>
            deps.logger.warn({ error: e.message }, 'could not queue text extraction'),
          );
      }
      if (outcome.status === 'clean') {
        // Best effort: a failed announcement must never fail or retry the scan itself. Ids only.
        await deps.events
          ?.publish({
            event: 'document.scan_clean',
            organizationId: String(org),
            data: {
              documentId: String(v.documentId),
              version: v.version,
              matterId: String(v.matterId),
              uploadedBy: String(v.uploadedBy),
            },
          })
          .catch((e: Error) =>
            deps.logger.warn({ error: e.message }, 'could not publish document.scan_clean'),
          );
      }
    } catch (err) {
      const isLast = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      deps.logger.warn(
        {
          versionId,
          attempt: job.attemptsMade + 1,
          final: isLast,
          error: (err as Error).message?.slice(0, 200),
        },
        'document scan attempt failed',
      );
      if (!isLast) throw err;
      await documentVersions.transition(org, v._id, ['scanning'], {
        status: 'scan_failed',
        scan: { engine: 'error', result: 'error', scannedAt: new Date() },
      });
      await audit.record(entry(v, 'document.scan_failed') as never);
      throw new UnrecoverableError('scan failed after all attempts');
    }
  };
}
