import { Inject, Injectable } from '@nestjs/common';
import { InvoiceModel, aiOutputs, documents, outbox, portalQueries } from '@assar/database';
import type { StorageService } from '@assar/storage';
import type {
  PortalAiOutput,
  PortalDocument,
  PortalInvoice,
  PortalMatter,
  PortalMessage,
} from '@assar/types';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, ClientContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { ENV, type Env } from '../config/env';
import { STORAGE } from '../storage/storage.token';

type Req = Pick<AppRequest, 'ip' | 'id'>;
type MatterRow = NonNullable<Awaited<ReturnType<typeof portalQueries.matter>>>;
type OutputRow = NonNullable<Awaited<ReturnType<typeof portalQueries.sharedAiOutput>>>;

/** One message for everything a client can't see, so existence of other records can't be probed. */
const notFound = () => new ApiError(404, 'NOT_FOUND', 'Not found');

/**
 * Client-facing data. These mappers are an allow-list: internal fields (descriptions, team, access lists,
 * internal notes, model names, source file names, verification details, storage keys) are never copied.
 */
const matterDto = (m: MatterRow): PortalMatter => ({
  id: String(m._id),
  matterNumber: m.matterNumber,
  title: m.title,
  practiceArea: m.practiceArea,
  status: m.status,
  note: m.portalNote ?? null,
  openedAt: m.openedAt.toISOString(),
  closedAt: m.closedAt ? m.closedAt.toISOString() : null,
});

const CLIENT_LABEL = 'Prepared with AI assistance and reviewed and approved by your legal team.';
const outputDto = (o: OutputRow): PortalAiOutput => {
  const result = o.result as {
    title?: string;
    body?: string;
    items?: { label?: string; text?: string; verified?: boolean }[];
  };
  const edited = o.editedText?.trim();
  return {
    id: String(o._id),
    matterId: String(o.matterId),
    task: o.task,
    title: result.title ?? '',
    body: edited || result.body || '',
    // Points the system could not check against the sources are never shown to clients. If a reviewer
    // rewrote the text, the model's points may no longer match it, so they are omitted too.
    points: edited
      ? []
      : (result.items ?? [])
          .filter((i) => i.verified)
          .map((i) => ({ label: i.label ?? '', text: i.text ?? '' })),
    label: CLIENT_LABEL,
    approvedAt: (o.reviewedAt ?? o.createdAt).toISOString(),
  };
};

@Injectable()
export class PortalService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(STORAGE) private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async matterFor(c: ClientContext, id: string): Promise<MatterRow> {
    const m = await portalQueries.matter(c.organizationId, c.clientId, id);
    if (!m) throw notFound();
    return m;
  }

  private usable(status: string) {
    return (
      status === 'clean' ||
      (status === 'skipped' &&
        this.env.SCAN_PROVIDER === 'disabled' &&
        this.env.NODE_ENV !== 'production')
    );
  }

  async matters(c: ClientContext) {
    return { data: (await portalQueries.matters(c.organizationId, c.clientId)).map(matterDto) };
  }

  async matter(c: ClientContext, id: string) {
    return matterDto(await this.matterFor(c, id));
  }

  async documents(c: ClientContext, matterId: string): Promise<{ data: PortalDocument[] }> {
    const m = await this.matterFor(c, matterId);
    const shared = await portalQueries.sharedDocuments(c.organizationId, m._id);
    return {
      data: shared
        .map(({ doc, versions }) => ({
          id: String(doc._id),
          matterId: String(m._id),
          title: doc.title,
          versions: versions
            .filter((v) => this.usable(v.status))
            .map((v) => ({
              version: v.version,
              filename: v.filename,
              contentType: v.contentType,
              sizeBytes: v.sizeBytes,
              sharedAt: (v.clientSharedAt ?? v.createdAt).toISOString(),
            })),
        }))
        .filter((d) => d.versions.length > 0),
    };
  }

  async downloadLink(c: ClientContext, documentId: string, version: number, req: Req) {
    const doc = await documents.findById(c.organizationId, documentId);
    if (!doc || doc.status !== 'active') throw notFound();
    const m = await this.matterFor(c, String(doc.matterId));
    const v =
      Number.isInteger(version) && version > 0
        ? await portalQueries.sharedVersion(c.organizationId, doc._id, version)
        : null;
    if (!v || !this.usable(v.status)) throw notFound();
    const link = await this.storage.createDownloadRequest(v.storageKey, {
      filename: v.filename,
      expiresInSeconds: this.env.DOWNLOAD_URL_TTL_SECONDS,
    });
    await this.audit.record({
      organizationId: c.organizationId,
      actorId: c.clientUserId,
      actorType: 'client',
      action: 'portal.document_downloaded',
      targetType: 'document',
      targetId: documentId,
      req,
      meta: { version: v.version, matterId: String(m._id) },
    });
    return { url: link.url, method: link.method, expiresAt: link.expiresAt, filename: v.filename };
  }

  async aiOutputs(c: ClientContext, matterId: string) {
    const m = await this.matterFor(c, matterId);
    return { data: (await portalQueries.sharedAiOutputs(c.organizationId, m._id)).map(outputDto) };
  }

  async invoices(c: ClientContext, matterId: string): Promise<{ data: PortalInvoice[] }> {
    const m = await this.matterFor(c, matterId);
    const rows = await InvoiceModel.find({
      organizationId: c.organizationId,
      clientId: c.clientId,
      matterIds: m._id,
      status: { $in: ['issued', 'paid'] },
    })
      .select('number status currency totalCents balanceCents issuedAt dueAt')
      .sort({ issuedAt: -1 })
      .limit(50)
      .lean();
    return {
      data: rows.map((row) => ({
        id: String(row._id),
        matterId: String(m._id),
        number: row.number ?? null,
        status: row.status as 'issued' | 'paid',
        currency: row.currency,
        totalCents: row.totalCents,
        balanceCents: row.balanceCents,
        issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
        dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      })),
    };
  }

  async messages(c: ClientContext, matterId: string): Promise<{ data: PortalMessage[] }> {
    const m = await this.matterFor(c, matterId);
    const rows = await outbox.releasedForClient(c.organizationId, c.clientId, m._id);
    return {
      data: rows.map((row) => ({
        id: String(row._id),
        matterId: String(m._id),
        channel: row.channel,
        body: row.body,
        status: row.status,
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      })),
    };
  }

  async aiOutput(c: ClientContext, id: string) {
    const out = await aiOutputs.findById(c.organizationId, id);
    if (!out) throw notFound();
    const m = await this.matterFor(c, String(out.matterId));
    const shared = await portalQueries.sharedAiOutput(c.organizationId, m._id, id);
    if (!shared) throw notFound();
    return outputDto(shared);
  }
}
