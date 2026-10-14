import { Inject, Injectable } from '@nestjs/common';
import { documentVersions, documents, type DocumentVersionDoc } from '@assar/database';
import type { z } from 'zod';
import type {
  createDocumentSchema,
  documentListQuerySchema,
  newVersionSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { randomToken } from '../common/crypto';
import { ApiError } from '../common/exception.filter';
import { ENV, type Env } from '../config/env';
import { MatterAccessService } from '../matters/matter-access.service';
import type { StorageService } from '@assar/storage';
import { STORAGE } from '../storage/storage.token';
import { ScanService } from './scan.service';

type Req = Pick<AppRequest, 'ip' | 'id'>;
type DocRow = NonNullable<Awaited<ReturnType<typeof documents.findById>>>;
type Upload = z.infer<typeof newVersionSchema>;

/** Storage keys and scan internals are never exposed. */
export const versionDto = (v: DocumentVersionDoc) => ({
  version: v.version,
  filename: v.filename,
  contentType: v.contentType,
  sizeBytes: v.sizeBytes,
  status: v.status,
  scanResult: v.scan?.result ?? null,
  uploadedBy: String(v.uploadedBy),
  completedAt: v.completedAt ?? null,
  createdAt: v.createdAt,
});

const documentDto = (d: DocRow) => ({
  id: String(d._id),
  matterId: String(d.matterId),
  title: d.title,
  latestVersion: d.latestVersion,
  createdBy: String(d.createdBy),
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

const STUCK_SCAN_MS = 10 * 60_000;

const BLOCKED_MESSAGES: Record<string, string> = {
  pending_upload: 'The file has not been uploaded yet',
  scanning: 'The file is still being security-scanned. Try again shortly.',
  infected: 'The file failed the security scan and is unavailable',
  scan_failed: 'The security scan could not be completed. A retry is required before download.',
  skipped: 'The file was not scanned and cannot be downloaded',
};

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(STORAGE) private readonly storage: StorageService,
    private readonly access: MatterAccessService,
    private readonly scanner: ScanService,
    private readonly audit: AuditService,
  ) {}

  /** Loads an active document the caller may access; hidden and missing are indistinguishable (404). */
  private async loadDocument(auth: AuthContext, id: string, req: Req): Promise<DocRow> {
    const doc = await documents.findById(auth.organizationId, id);
    if (!doc || doc.status !== 'active') throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    await this.access.loadFor(auth, String(doc.matterId), req, 'Document not found');
    return doc;
  }

  private async loadVersion(auth: AuthContext, doc: DocRow, version: number) {
    const v =
      Number.isInteger(version) && version > 0
        ? await documentVersions.find(auth.organizationId, doc._id, version)
        : null;
    if (!v) throw new ApiError(404, 'NOT_FOUND', 'Version not found');
    return v;
  }

  private async startVersion(auth: AuthContext, doc: DocRow, input: Upload, req: Req) {
    if (input.sizeBytes > this.env.MAX_UPLOAD_BYTES) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        `File exceeds the maximum upload size of ${this.env.MAX_UPLOAD_BYTES} bytes`,
      );
    }
    const orgId = auth.organizationId;
    const number = await documents.allocateVersion(orgId, doc._id);
    if (number === null) throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    const storageKey = `org/${orgId}/matter/${doc.matterId}/doc/${doc._id}/v${number}-${randomToken(12)}`;
    const version = await documentVersions.create({
      organizationId: orgId as never,
      documentId: doc._id,
      matterId: doc.matterId,
      version: number,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      storageKey,
      status: 'pending_upload',
      scan: null,
      uploadedBy: auth.userId as never,
      completedAt: null,
    });
    const upload = await this.storage.createUploadRequest(storageKey, {
      sizeBytes: input.sizeBytes,
      expiresInSeconds: this.env.UPLOAD_URL_TTL_SECONDS,
    });
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'document.upload_requested',
      targetType: 'document',
      targetId: String(doc._id),
      req,
      meta: { version: number, sizeBytes: input.sizeBytes, contentType: input.contentType },
    });
    return { version: versionDto(version), upload };
  }

  async create(
    auth: AuthContext,
    matterId: string,
    input: z.infer<typeof createDocumentSchema>,
    req: Req,
  ) {
    await this.access.load(auth, matterId, req);
    const doc = await documents.create(auth.organizationId, matterId, auth.userId, input.title);
    const { version, upload } = await this.startVersion(auth, doc, input, req);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.created',
      targetType: 'document',
      targetId: String(doc._id),
      req,
      meta: { matterId },
    });
    return { document: { ...documentDto(doc), latestVersion: version.version }, version, upload };
  }

  async addVersion(auth: AuthContext, id: string, input: Upload, req: Req) {
    const doc = await this.loadDocument(auth, id, req);
    const { version, upload } = await this.startVersion(auth, doc, input, req);
    return { document: { ...documentDto(doc), latestVersion: version.version }, version, upload };
  }

  async complete(auth: AuthContext, id: string, versionNo: number, req: Req) {
    const doc = await this.loadDocument(auth, id, req);
    const v = await this.loadVersion(auth, doc, versionNo);
    if (v.status !== 'pending_upload') return versionDto(v); // idempotent: already completed

    const head = await this.storage.head(v.storageKey);
    if (!head)
      throw new ApiError(400, 'VALIDATION_FAILED', 'No uploaded file was found for this version');
    if (head.sizeBytes !== v.sizeBytes) {
      await this.storage.delete(v.storageKey); // don't keep content that doesn't match what was declared
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'Uploaded file size does not match the declared size',
      );
    }
    const moved = await documentVersions.transition(
      auth.organizationId,
      v._id,
      ['pending_upload'],
      { status: 'scanning', completedAt: new Date() },
    );
    if (!moved)
      return versionDto((await documentVersions.findById(auth.organizationId, v._id)) ?? v);
    await this.scanner.dispatch(moved, 'pending_upload');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.upload_completed',
      targetType: 'document',
      targetId: id,
      req,
      meta: { version: v.version },
    });
    return versionDto(moved);
  }

  /** Retry after `scan_failed` (e.g. scanner was down). */
  async rescan(auth: AuthContext, id: string, versionNo: number, req: Req) {
    const doc = await this.loadDocument(auth, id, req);
    const v = await this.loadVersion(auth, doc, versionNo);
    if (!(await this.storage.head(v.storageKey)))
      throw new ApiError(409, 'CONFLICT', 'The stored file is no longer available');
    // A scan "running" for far too long was most likely lost (e.g. the API restarted mid-scan).
    const stuck =
      v.status === 'scanning' &&
      !!v.completedAt &&
      Date.now() - v.completedAt.getTime() > STUCK_SCAN_MS;
    const moved = await documentVersions.transition(
      auth.organizationId,
      v._id,
      stuck ? ['scanning'] : ['scan_failed'],
      { status: 'scanning', completedAt: new Date() },
    );
    if (!moved) {
      throw new ApiError(
        409,
        'CONFLICT',
        'Only versions whose scan failed (or got stuck) can be re-scanned',
      );
    }
    await this.scanner.dispatch(moved, 'scan_failed');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.rescan_requested',
      targetType: 'document',
      targetId: id,
      req,
      meta: { version: v.version },
    });
    return versionDto(moved);
  }

  async list(
    auth: AuthContext,
    matterId: string,
    q: z.infer<typeof documentListQuerySchema>,
    req: Req,
  ) {
    await this.access.load(auth, matterId, req);
    const page = await documents.listForMatter(auth.organizationId, matterId, q.limit, q.cursor);
    const latest = await documentVersions.latestFor(
      auth.organizationId,
      page.data.map((d) => d._id),
    );
    return {
      data: page.data.map((d) => {
        const v = latest.get(String(d._id));
        return { ...documentDto(d), latest: v ? versionDto(v) : null };
      }),
      page: page.page,
    };
  }

  async get(auth: AuthContext, id: string, req: Req) {
    const doc = await this.loadDocument(auth, id, req);
    const versions = await documentVersions.listForDocument(auth.organizationId, doc._id);
    return { ...documentDto(doc), versions: versions.map(versionDto) };
  }

  async rename(auth: AuthContext, id: string, title: string, req: Req) {
    await this.loadDocument(auth, id, req);
    const doc = await documents.rename(auth.organizationId, id, title);
    if (!doc) throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.renamed',
      targetType: 'document',
      targetId: id,
      req,
    });
    return documentDto(doc);
  }

  async remove(auth: AuthContext, id: string, req: Req) {
    await this.loadDocument(auth, id, req);
    if (!(await documents.softDelete(auth.organizationId, id, auth.userId)))
      throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.deleted',
      targetType: 'document',
      targetId: id,
      req,
    });
  }

  async downloadLink(auth: AuthContext, id: string, versionNo: number, req: Req) {
    const doc = await this.loadDocument(auth, id, req);
    const v = await this.loadVersion(auth, doc, versionNo);
    const unscannedAllowed =
      v.status === 'skipped' &&
      this.env.SCAN_PROVIDER === 'disabled' &&
      this.env.NODE_ENV !== 'production';
    if (v.status !== 'clean' && !unscannedAllowed) {
      throw new ApiError(
        409,
        'CONFLICT',
        BLOCKED_MESSAGES[v.status] ?? 'The file is not available',
      );
    }
    const link = await this.storage.createDownloadRequest(v.storageKey, {
      filename: v.filename,
      expiresInSeconds: this.env.DOWNLOAD_URL_TTL_SECONDS,
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.download_link_issued',
      targetType: 'document',
      targetId: id,
      req,
      meta: { version: v.version },
    });
    return { url: link.url, method: link.method, expiresAt: link.expiresAt, filename: v.filename };
  }
}
