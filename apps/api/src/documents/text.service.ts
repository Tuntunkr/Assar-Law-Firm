import { Inject, Injectable } from '@nestjs/common';
import {
  documentTexts,
  documentVersions,
  documents,
  keyTerms,
  matters,
  similarity,
} from '@assar/database';
import type { JobQueues } from '@assar/jobs';
import type { z } from 'zod';
import type { textSearchQuerySchema } from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { randomToken } from '../common/crypto';
import { ApiError } from '../common/exception.filter';
import { ENV, type Env } from '../config/env';
import { MatterAccessService } from '../matters/matter-access.service';
import { QUEUES } from '../queue/queue.module';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const PREVIEW_CHARS = 20_000;

/** A short passage around the first place a search word appears. */
function snippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const at =
    words
      .map((w) => lower.indexOf(w))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const from = Math.max(0, at - 100);
  const piece = text
    .slice(from, from + 260)
    .replace(/\s+/g, ' ')
    .trim();
  return `${from > 0 ? '…' : ''}${piece}${from + 260 < text.length ? '…' : ''}`;
}

/** Reading, searching and comparing the text of documents. Everything honours matter access. */
@Injectable()
export class TextService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(QUEUES) private readonly queues: JobQueues,
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
  ) {}

  private async version(auth: AuthContext, id: string, versionNo: number, req: Req) {
    const doc = await documents.findById(auth.organizationId, id);
    if (!doc || doc.status !== 'active') throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    await this.access.loadFor(auth, String(doc.matterId), req, 'Document not found');
    const v =
      Number.isInteger(versionNo) && versionNo > 0
        ? await documentVersions.find(auth.organizationId, doc._id, versionNo)
        : null;
    if (!v) throw new ApiError(404, 'NOT_FOUND', 'Version not found');
    return { doc, v };
  }

  async get(auth: AuthContext, id: string, versionNo: number, full: boolean, req: Req) {
    const { doc, v } = await this.version(auth, id, versionNo, req);
    const row = await documentTexts.find(auth.organizationId, v._id);
    if (!row) return { status: 'none' as const };
    const { text, ...meta } = row;
    const base = {
      status: row.status,
      method: row.method ?? null,
      pages: row.pages ?? null,
      ocrPages: row.ocrPages ?? null,
      confidence: row.confidence ?? null,
      truncated: !!row.truncated,
      chars: row.chars ?? null,
      error: row.error ?? null,
      extractedAt: meta.extractedAt ?? null,
    };
    if (row.status !== 'done') return base;
    const body = text ?? '';
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.text_viewed',
      targetType: 'document',
      targetId: String(doc._id),
      req,
      meta: { version: versionNo, full },
    });
    return {
      ...base,
      text: full ? body : body.slice(0, PREVIEW_CHARS),
      textTruncated: !full && body.length > PREVIEW_CHARS,
    };
  }

  /** Re-reads a version, e.g. after a failure or to pick up a newer OCR setup. */
  async requestExtract(auth: AuthContext, id: string, versionNo: number, req: Req) {
    const { doc, v } = await this.version(auth, id, versionNo, req);
    const readable =
      v.status === 'clean' ||
      (v.status === 'skipped' &&
        this.env.SCAN_PROVIDER === 'disabled' &&
        this.env.NODE_ENV !== 'production');
    if (!readable)
      throw new ApiError(
        409,
        'CONFLICT',
        'The file must pass the security scan before its text is read',
      );
    await documentTexts.start({
      organizationId: v.organizationId,
      matterId: v.matterId,
      documentId: v.documentId,
      version: v.version,
      versionId: v._id,
    });
    try {
      await this.queues.enqueueExtract(
        { organizationId: String(v.organizationId), versionId: String(v._id) },
        randomToken(6),
      );
    } catch {
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'The processing queue is unavailable. Please try again shortly.',
      );
    }
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'document.text_requested',
      targetType: 'document',
      targetId: String(doc._id),
      req,
      meta: { version: versionNo },
    });
    return { status: 'pending' as const };
  }

  /** Rows → one per active document (newest version first), labelled with their matter. */
  private async label(
    auth: AuthContext,
    rows: { documentId: unknown; matterId: unknown; version: number }[],
  ) {
    const active = await documents.activeByIds(auth.organizationId, [
      ...new Set(rows.map((r) => String(r.documentId))),
    ] as never);
    const labels = await matters.summaries(auth.organizationId, [
      ...new Set(rows.map((r) => String(r.matterId))),
    ] as never);
    const byMatter = new Map(labels.map((m) => [String(m._id), m]));
    return (r: { documentId: unknown; matterId: unknown }) => {
      const d = active.get(String(r.documentId));
      if (!d) return null;
      const m = byMatter.get(String(r.matterId));
      return {
        documentId: String(r.documentId),
        title: d.title,
        matter: m
          ? {
              id: String(m._id),
              matterNumber: m.matterNumber,
              title: m.title,
              clientId: String(m.clientId),
            }
          : null,
      };
    };
  }

  async search(auth: AuthContext, q: z.infer<typeof textSearchQuerySchema>, req: Req) {
    if (q.matterId) await this.access.load(auth, q.matterId, req);
    const hidden = await this.access.hiddenMatterIds(auth);
    let only: string[] | undefined = q.matterId ? [q.matterId] : undefined;
    if (q.clientId) {
      const ofClient = (await matters.idsForClient(auth.organizationId, q.clientId)).map(String);
      only = only ? only.filter((m) => ofClient.includes(m)) : ofClient;
    }
    const rows = await documentTexts.search(auth.organizationId, {
      query: q.q,
      limit: q.limit,
      onlyMatterIds: only as never,
      excludeMatterIds: hidden as never,
    });
    // Best-scoring version of each document only.
    const seen = new Set<string>();
    const best = rows
      .filter((r) => !seen.has(String(r.documentId)) && seen.add(String(r.documentId)))
      .slice(0, q.limit);
    const label = await this.label(auth, best);
    const texts = await documentTexts.textsOf(auth.organizationId, best.map((r) => r._id) as never);
    const data = best
      .map((r) => {
        const l = label(r);
        return (
          l && {
            ...l,
            version: r.version,
            method: r.method ?? null,
            snippet: snippet(texts.get(String(r._id)) ?? '', q.q),
          }
        );
      })
      .filter(Boolean);
    return { data };
  }

  async similar(auth: AuthContext, id: string, limit: number, req: Req) {
    const doc = await documents.findById(auth.organizationId, id);
    if (!doc || doc.status !== 'active') throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    await this.access.loadFor(auth, String(doc.matterId), req, 'Document not found');
    const source = await documentTexts.latestDone(auth.organizationId, doc._id);
    if (!source?.text)
      throw new ApiError(409, 'CONFLICT', 'The text of this document has not been read yet');
    const terms = keyTerms(source.text, 20);
    if (terms.length === 0) return { data: [] };
    const hidden = await this.access.hiddenMatterIds(auth);
    const rows = await documentTexts.search(auth.organizationId, {
      query: terms.join(' '),
      limit: limit * 2,
      excludeMatterIds: hidden as never,
      excludeDocumentId: doc._id,
    });
    const seen = new Set<string>();
    const candidates = rows
      .filter((r) => !seen.has(String(r.documentId)) && seen.add(String(r.documentId)))
      .slice(0, limit * 2);
    const label = await this.label(auth, candidates);
    const texts = await documentTexts.textsOf(
      auth.organizationId,
      candidates.map((r) => r._id) as never,
    );
    const data = candidates
      .map((r) => {
        const l = label(r);
        if (!l) return null;
        const s = similarity(source.text!, texts.get(String(r._id)) ?? '');
        return {
          ...l,
          version: r.version,
          similarity: Math.round(s.score * 100) / 100,
          sharedTerms: s.shared,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.similarity >= 0.05)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    return { data };
  }
}
