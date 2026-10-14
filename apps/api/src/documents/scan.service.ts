import { Inject, Injectable } from '@nestjs/common';
import { documentVersions, type DocumentVersionDoc } from '@assar/database';
import { AuditService } from '../audit/audit.service';
import { LOGGER, type Logger } from '../common/logger';
import { STORAGE, type StorageService } from '../storage/storage.service';
import { SCAN_PROVIDER, type ScanProvider } from './scan.provider';

type Version = Pick<
  DocumentVersionDoc,
  '_id' | 'organizationId' | 'documentId' | 'matterId' | 'version' | 'storageKey' | 'uploadedBy'
>;

/**
 * Upload scanning hook. `dispatch` is called when an upload completes (status `scanning`).
 * Today it runs in-process after the HTTP response; the same entry point will be backed by the
 * job queue in Phase 6. Statuses are always real: nothing becomes `clean` unless a scanner said so.
 */
@Injectable()
export class ScanService {
  private readonly inFlight = new Set<string>();

  constructor(
    @Inject(SCAN_PROVIDER) private readonly provider: ScanProvider,
    @Inject(STORAGE) private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  dispatch(version: Version): void {
    const id = String(version._id);
    if (this.inFlight.has(id)) return;
    this.inFlight.add(id);
    void this.run(version)
      .catch((err: unknown) => this.logger.error({ err, versionId: id }, 'scan dispatch failed'))
      .finally(() => this.inFlight.delete(id));
  }

  /** Resolves when no scans are running (used by tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await new Promise((r) => setTimeout(r, 20));
  }

  private async run(v: Version): Promise<void> {
    const orgId = String(v.organizationId);
    const base = {
      organizationId: orgId,
      targetType: 'document_version',
      targetId: String(v._id),
      actorId: null,
    } as const;
    try {
      const outcome = await this.provider.scan(await this.storage.read(v.storageKey));
      const scan = {
        engine: outcome.engine,
        result: outcome.status === 'infected' ? outcome.signature : outcome.status,
        scannedAt: new Date(),
      };
      const updated = await documentVersions.transition(orgId, v._id, ['scanning'], {
        status: outcome.status,
        scan,
      });
      if (!updated) return; // someone else already moved it
      if (outcome.status === 'infected') await this.storage.delete(v.storageKey); // never keep infected content
      await this.audit.record({
        ...base,
        action: `document.scan_${outcome.status}`,
        meta: { documentId: String(v.documentId), version: v.version, engine: outcome.engine },
      });
    } catch (err) {
      this.logger.error({ err, versionId: String(v._id) }, 'document scan failed');
      await documentVersions.transition(orgId, v._id, ['scanning'], {
        status: 'scan_failed',
        scan: { engine: 'error', result: 'error', scannedAt: new Date() },
      });
      await this.audit.record({
        ...base,
        action: 'document.scan_failed',
        meta: { documentId: String(v.documentId), version: v.version },
      });
    }
  }
}
