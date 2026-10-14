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
