import type { Types } from 'mongoose';
import { decodeCursor, toPage } from '../pagination.js';
import { mongoose } from '../connection.js';
import {
  CalendarEventModel,
  DocumentModel,
  DocumentVersionModel,
  MatterModel,
  TaskModel,
  type CalendarEventDoc,
  type DocumentVersionDoc,
  type DocumentVersionStatus,
  type TaskDoc,
  DocumentTextModel,
  MAX_STORED_TEXT_CHARS,
  type DocumentTextDoc,
} from '../models/index.js';
import { InvalidCursorError } from './index.js';

type Id = Types.ObjectId | string;

function idCursor(cursor?: string) {
  const c = decodeCursor(cursor);
  if (c === null) throw new InvalidCursorError();
  return c ? { _id: { $lt: c } } : {};
}

// Every function takes organizationId first and applies it to the query.

export const documents = {
  create: async (organizationId: Id, matterId: Id, createdBy: Id, title: string) =>
    (await DocumentModel.create({ organizationId, matterId, createdBy, title })).toObject(),
  findById: (organizationId: Id, id: Id) =>
    DocumentModel.findOne({ _id: id, organizationId }).lean(),
  /** Atomically reserves the next version number. Null if the document is gone. */
  async allocateVersion(organizationId: Id, id: Id): Promise<number | null> {
    const d = await DocumentModel.findOneAndUpdate(
      { _id: id, organizationId, status: 'active' },
      { $inc: { latestVersion: 1 } },
      { returnDocument: 'after' },
    ).lean();
    return d ? d.latestVersion : null;
  },
  async listForMatter(organizationId: Id, matterId: Id, limit: number, cursor?: string) {
    const filter: Record<string, unknown> = {
      organizationId,
      matterId,
      status: 'active',
      ...idCursor(cursor),
    };
    const rows = await DocumentModel.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    return toPage(rows, limit);
  },
  /**
   * Firm-wide listing. `onlyMatterIds` narrows to a set (a client's matters); `excludeMatterIds` removes
   * restricted matters the caller cannot see. Title search is a case-insensitive prefix/substring match.
   */
  async search(
    organizationId: Id,
    o: {
      limit: number;
      cursor?: string;
      q?: string;
      onlyMatterIds?: Id[];
      excludeMatterIds: Id[];
    },
  ) {
    const filter: Record<string, unknown> = {
      organizationId,
      status: 'active',
      ...idCursor(o.cursor),
    };
    const matterClause: Record<string, unknown> = {};
    if (o.onlyMatterIds) matterClause.$in = o.onlyMatterIds;
    if (o.excludeMatterIds.length) matterClause.$nin = o.excludeMatterIds;
    if (Object.keys(matterClause).length) filter.matterId = matterClause;
    if (o.q) filter.title = { $regex: o.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const rows = await DocumentModel.find(filter)
      .sort({ _id: -1 })
      .limit(o.limit + 1)
      .lean();
    return toPage(rows, o.limit);
  },
  /** Titles for a set of documents, active ones only (deleted documents never show up in search). */
  async activeByIds(organizationId: Id, ids: Id[]) {
    if (ids.length === 0) return new Map<string, { title: string; matterId: Id }>();
    const rows = await DocumentModel.find({ organizationId, _id: { $in: ids }, status: 'active' })
      .select('title matterId')
      .lean();
    return new Map(
      rows.map((d) => [String(d._id), { title: d.title, matterId: d.matterId as Id }]),
    );
  },
  rename: (organizationId: Id, id: Id, title: string) =>
    DocumentModel.findOneAndUpdate(
      { _id: id, organizationId, status: 'active' },
      { title },
      { returnDocument: 'after', runValidators: true },
    ).lean(),
  /** Soft delete only: versions and objects are retained for legal-hold review. */
  softDelete: (organizationId: Id, id: Id, by: Id) =>
    DocumentModel.findOneAndUpdate(
      { _id: id, organizationId, status: 'active' },
      { status: 'deleted', deletedAt: new Date(), deletedBy: by },
      { returnDocument: 'after' },
    ).lean(),
};

export const documentVersions = {
  create: async (data: Omit<DocumentVersionDoc, '_id' | 'createdAt'>) =>
    (await DocumentVersionModel.create(data)).toObject(),
  find: (organizationId: Id, documentId: Id, version: number) =>
    DocumentVersionModel.findOne({ organizationId, documentId, version }).lean(),
  findById: (organizationId: Id, id: Id) =>
    DocumentVersionModel.findOne({ _id: id, organizationId }).lean(),
  listForDocument: (organizationId: Id, documentId: Id) =>
    DocumentVersionModel.find({ organizationId, documentId })
      .sort({ version: -1 })
      .limit(500)
      .lean(),
  /** Latest version row per document (by version number), for list views. */
  async latestFor(organizationId: Id, documentIds: Id[]) {
    if (documentIds.length === 0) return new Map<string, DocumentVersionDoc>();
    const rows = await DocumentVersionModel.aggregate<DocumentVersionDoc>([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(String(organizationId)),
          documentId: { $in: documentIds.map((d) => new mongoose.Types.ObjectId(String(d))) },
        },
      },
      { $sort: { version: -1 } },
      { $group: { _id: '$documentId', doc: { $first: '$$ROOT' } } },
    ]);
    return new Map(
      rows.map((r) => [String(r._id), (r as unknown as { doc: DocumentVersionDoc }).doc]),
    );
  },
  /** Compare-and-set on status so concurrent callers can't both win a transition. */
  transition: (
    organizationId: Id,
    id: Id,
    from: DocumentVersionStatus[],
    patch: Partial<Pick<DocumentVersionDoc, 'status' | 'scan' | 'completedAt'>>,
  ) =>
    DocumentVersionModel.findOneAndUpdate(
      { _id: id, organizationId, status: { $in: from } },
      patch,
      { returnDocument: 'after' },
    ).lean(),
};

function eventCursor(cursor?: string): { startsAt: Date; id: Types.ObjectId } | null | undefined {
  if (!cursor) return undefined;
  const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('_');
  if (!ts || !id || !/^\d+$/.test(ts) || !mongoose.isValidObjectId(id) || id.length !== 24)
    return null;
  return { startsAt: new Date(Number(ts)), id: new mongoose.Types.ObjectId(id) };
}

export const calendar = {
  create: async (data: Omit<CalendarEventDoc, '_id' | 'createdAt' | 'updatedAt' | 'source'>) =>
    (await CalendarEventModel.create(data)).toObject(),
  findById: (organizationId: Id, id: Id) =>
    CalendarEventModel.findOne({ _id: id, organizationId }).lean(),
  update: (organizationId: Id, id: Id, patch: Record<string, unknown>) =>
    CalendarEventModel.findOneAndUpdate({ _id: id, organizationId }, patch, {
      returnDocument: 'after',
      runValidators: true,
    }).lean(),
  delete: (organizationId: Id, id: Id) => CalendarEventModel.deleteOne({ _id: id, organizationId }),
  async listRange(
    organizationId: Id,
    o: {
      from: Date;
      to: Date;
      kind?: string;
      matterId?: string;
      hiddenMatterIds: Id[];
      limit: number;
      cursor?: string;
    },
  ) {
    const c = eventCursor(o.cursor);
    if (c === null) throw new InvalidCursorError();
    const and: Record<string, unknown>[] = [];
    if (c)
      and.push({
        $or: [{ startsAt: { $gt: c.startsAt } }, { startsAt: c.startsAt, _id: { $gt: c.id } }],
      });
    const filter: Record<string, unknown> = {
      organizationId,
      startsAt: { $gte: o.from, $lt: o.to },
      // Events on restricted matters the caller can't see are excluded; org-level events have no matterId.
      matterId: o.matterId ? o.matterId : { $nin: o.hiddenMatterIds },
      ...(o.kind ? { kind: o.kind } : {}),
      ...(and.length ? { $and: and } : {}),
    };
    const rows = await CalendarEventModel.find(filter)
      .sort({ startsAt: 1, _id: 1 })
      .limit(o.limit + 1)
      .lean();
    const hasMore = rows.length > o.limit;
    const data = hasMore ? rows.slice(0, o.limit) : rows;
    const last = data[data.length - 1];
    return {
      data,
      page: {
        nextCursor:
          hasMore && last
            ? Buffer.from(`${last.startsAt.getTime()}_${last._id}`).toString('base64url')
            : null,
        limit: o.limit,
      },
    };
  },
};

export const tasks = {
  create: async (data: Omit<TaskDoc, '_id' | 'createdAt' | 'updatedAt'>) =>
    (await TaskModel.create(data)).toObject(),
  findById: (organizationId: Id, id: Id) => TaskModel.findOne({ _id: id, organizationId }).lean(),
  update: (organizationId: Id, id: Id, patch: Record<string, unknown>) =>
    TaskModel.findOneAndUpdate({ _id: id, organizationId }, patch, {
      returnDocument: 'after',
      runValidators: true,
    }).lean(),
  delete: (organizationId: Id, id: Id) => TaskModel.deleteOne({ _id: id, organizationId }),
  openAssigneeIds: async (organizationId: Id, matterId: Id) =>
    (
      await TaskModel.find({
        organizationId,
        matterId,
        status: { $in: ['todo', 'in_progress'] },
        assigneeId: { $ne: null },
      })
        .select('assigneeId')
        .lean()
    ).map((t) => t.assigneeId!),
  async listPage(
    organizationId: Id,
    o: {
      limit: number;
      cursor?: string;
      assigneeId?: string;
      status?: string;
      matterId?: string;
      dueBefore?: Date;
      hiddenMatterIds: Id[];
    },
  ) {
    const filter: Record<string, unknown> = {
      organizationId,
      matterId: o.matterId ? o.matterId : { $nin: o.hiddenMatterIds },
      ...(o.assigneeId ? { assigneeId: o.assigneeId } : {}),
      ...(o.status ? { status: o.status } : {}),
      ...(o.dueBefore ? { dueAt: { $lte: o.dueBefore } } : {}),
      ...idCursor(o.cursor),
    };
    const rows = await TaskModel.find(filter)
      .sort({ _id: -1 })
      .limit(o.limit + 1)
      .lean();
    return toPage(rows, o.limit);
  },
};

export const matterVisibility = {
  /** Ids of all restricted matters in the organization. */
  restrictedIds: async (organizationId: Id) =>
    (
      await MatterModel.find({ organizationId, restricted: true })
        .select('_id')
        .limit(10_000)
        .lean()
    ).map((m) => m._id),
};

// ---- Extracted document text, search and similarity ----

// \p{M}: vowel signs and other combining marks, which are part of a word in Hindi and many other scripts.
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
const STOP = new Set(
  (
    'the and for that with this from have has had not are was were been being shall will would should could may might must can ' +
    'which their there these those such any all each other than then them they his her its our your you who whom whose what when where why how ' +
    'into onto upon under over between among within without about after before above below also only more most less very ' +
    'hereby herein hereof hereto thereof thereto whereas hereinafter said same per via'
  ).split(' '),
);

/** Lower-cased words of at least 4 letters, minus very common ones. Language-agnostic (uses Unicode letters). */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((w) => w.length >= 4 && !STOP.has(w));
}

function termFrequencies(text: string, limit = 4000): Map<string, number> {
  const tf = new Map<string, number>();
  for (const w of tokenize(text)) tf.set(w, (tf.get(w) ?? 0) + 1);
  if (tf.size <= limit) return tf;
  return new Map([...tf].sort((a, b) => b[1] - a[1]).slice(0, limit));
}

/** Cosine similarity of two documents' word counts: 0 (nothing shared) to 1 (same words). */
export function similarity(a: string, b: string): { score: number; shared: string[] } {
  const ta = termFrequencies(a);
  const tb = termFrequencies(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  const shared: [string, number][] = [];
  for (const [w, x] of ta) {
    na += x * x;
    const y = tb.get(w);
    if (y) {
      dot += x * y;
      shared.push([w, Math.min(x, y)]);
    }
  }
  for (const y of tb.values()) nb += y * y;
  const score = na && nb ? dot / Math.sqrt(na * nb) : 0;
  return {
    score,
    shared: shared
      .sort((p, q) => q[1] - p[1])
      .slice(0, 8)
      .map(([w]) => w),
  };
}

/** The words that best characterise a document, for use as a search query. */
export function keyTerms(text: string, n = 15): string[] {
  return [...termFrequencies(text)]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

export const documentTexts = {
  find: (organizationId: Id, versionId: Id) =>
    DocumentTextModel.findOne({ organizationId, versionId }).lean(),
  /** Status rows only (no text) for a set of versions. */
  async statusFor(organizationId: Id, versionIds: Id[]) {
    if (versionIds.length === 0) return new Map<string, Omit<DocumentTextDoc, 'text'>>();
    const rows = await DocumentTextModel.find({ organizationId, versionId: { $in: versionIds } })
      .select('-text')
      .lean();
    return new Map(rows.map((r) => [String(r.versionId), r]));
  },
  /** Creates the row (or resets it for a re-run). Returns the row. */
  start: (
    v: Pick<DocumentTextDoc, 'organizationId' | 'matterId' | 'documentId' | 'version'> & {
      versionId: Id;
    },
  ) =>
    DocumentTextModel.findOneAndUpdate(
      { organizationId: v.organizationId, versionId: v.versionId },
      {
        $set: {
          matterId: v.matterId,
          documentId: v.documentId,
          version: v.version,
          status: 'pending',
          error: null,
          text: '',
          chars: null,
          method: null,
          pages: null,
          ocrPages: null,
          confidence: null,
          truncated: false,
          extractedAt: null,
        },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean(),
  setProcessing: (organizationId: Id, versionId: Id) =>
    DocumentTextModel.findOneAndUpdate(
      { organizationId, versionId, status: { $in: ['pending', 'processing'] } },
      { status: 'processing' },
      { returnDocument: 'after' },
    ).lean(),
  save: (
    organizationId: Id,
    versionId: Id,
    r: {
      text: string;
      method: 'text' | 'ocr' | 'mixed';
      pages: number;
      ocrPages: number;
      confidence: number | null;
      truncated: boolean;
    },
  ) => {
    const cut = r.text.length > MAX_STORED_TEXT_CHARS;
    const text = cut ? r.text.slice(0, MAX_STORED_TEXT_CHARS) : r.text;
    return DocumentTextModel.findOneAndUpdate(
      { organizationId, versionId },
      {
        status: 'done',
        text,
        chars: text.length,
        method: r.method,
        pages: r.pages,
        ocrPages: r.ocrPages,
        confidence: r.confidence,
        truncated: r.truncated || cut,
        error: null,
        extractedAt: new Date(),
      },
      { returnDocument: 'after' },
    ).lean();
  },
  fail: (organizationId: Id, versionId: Id, error: { code: string; message: string }) =>
    DocumentTextModel.findOneAndUpdate(
      { organizationId, versionId },
      { status: 'failed', error, text: '', chars: null, extractedAt: new Date() },
      { returnDocument: 'after' },
    ).lean(),
  /**
   * Full-text search over extracted text. `onlyMatterIds` narrows to a set; `excludeMatterIds` removes
   * matters the caller may not see. Only the newest finished version of each document is considered.
   */
  async search(
    organizationId: Id,
    o: {
      query: string;
      limit: number;
      onlyMatterIds?: Id[];
      excludeMatterIds: Id[];
      excludeDocumentId?: Id;
    },
  ) {
    const filter: Record<string, unknown> = {
      organizationId,
      status: 'done',
      $text: { $search: o.query },
    };
    const m: Record<string, unknown> = {};
    if (o.onlyMatterIds) m.$in = o.onlyMatterIds;
    if (o.excludeMatterIds.length) m.$nin = o.excludeMatterIds;
    if (Object.keys(m).length) filter.matterId = m;
    if (o.excludeDocumentId) filter.documentId = { $ne: o.excludeDocumentId };
    // The text itself is not loaded here (it can be megabytes); callers fetch it for the few they show.
    return DocumentTextModel.find(filter, { text: 0, score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(o.limit * 3) // several versions of one document can match; trimmed by the caller
      .lean<(Omit<DocumentTextDoc, 'text'> & { score: number })[]>();
  },
  /** Just the text of some rows, keyed by row id. */
  async textsOf(organizationId: Id, ids: Id[]) {
    const rows = await DocumentTextModel.find({ organizationId, _id: { $in: ids } })
      .select('text')
      .lean();
    return new Map(rows.map((r) => [String(r._id), r.text ?? '']));
  },
  /** The newest finished text of a document, with its text. */
  latestDone: (organizationId: Id, documentId: Id) =>
    DocumentTextModel.findOne({ organizationId, documentId, status: 'done' })
      .sort({ version: -1 })
      .lean(),
};
