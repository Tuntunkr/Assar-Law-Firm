import { Inject, Injectable } from '@nestjs/common';
import {
  documentVersions,
  type DocumentVersionDoc,
  type DocumentVersionStatus,
} from '@assar/database';
import type { JobQueues } from '@assar/jobs';
import { randomToken } from '../common/crypto';
import { ApiError } from '../common/exception.filter';
import { QUEUES } from '../queue/queue.module';

type Version = Pick<DocumentVersionDoc, '_id' | 'organizationId'>;

/**
 * Upload scanning hook: hands a version (already in `scanning`) to the job queue. The worker scans it,
 * retries transient failures, and records the real outcome. If the queue can't be reached the version is
 * put back in `revertTo` so it never sits in `scanning` with nothing working on it.
 */
@Injectable()
export class ScanService {
  constructor(@Inject(QUEUES) private readonly queues: JobQueues) {}

  async dispatch(
    version: Version,
    revertTo: Extract<DocumentVersionStatus, 'pending_upload' | 'scan_failed'>,
  ) {
    try {
      await this.queues.enqueueScan(
        { organizationId: String(version.organizationId), versionId: String(version._id) },
        randomToken(6),
      );
    } catch {
      await documentVersions.transition(version.organizationId, version._id, ['scanning'], {
        status: revertTo,
      });
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'The processing queue is unavailable. Please try again shortly.',
      );
    }
  }
}
