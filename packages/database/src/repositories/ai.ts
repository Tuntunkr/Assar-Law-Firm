import type { Types } from 'mongoose';
import { decodeCursor, toPage } from '../pagination.js';
import {
  AiJobModel,
  AiOutputModel,
  MatterAccessModel,
  MatterModel,
  MembershipModel,
  type AiJobDoc,
  type AiJobStatus,
  type AiOutputDoc,
} from '../models/index.js';
import { InvalidCursorError } from './index.js';

type Id = Types.ObjectId | string;

function cursor(c?: string) {
  const d = decodeCursor(c);
  if (d === null) throw new InvalidCursorError();
  return d ? { _id: { $lt: d } } : {};
}

// Every function takes organizationId first and applies it to the query.

export const aiJobs = {
  create: async (
    data: Pick<AiJobDoc, 'organizationId' | 'matterId' | 'requestedBy' | 'task' | 'documents'> &
      Partial<AiJobDoc>,
  ) => (await AiJobModel.create(data)).toObject(),
  findById: (organizationId: Id, id: Id) => AiJobModel.findOne({ _id: id, organizationId }).lean(),
  /** Queued + processing jobs, used for a per-organization cost cap. */
  countActive: (organizationId: Id) =>
    AiJobModel.countDocuments({ organizationId, status: { $in: ['queued', 'processing'] } }),
  /** Compare-and-set on status so concurrent workers/requests can't both win a transition. */
  transition: (organizationId: Id, id: Id, from: AiJobStatus[], patch: Record<string, unknown>) =>
    AiJobModel.findOneAndUpdate({ _id: id, organizationId, status: { $in: from } }, patch, {
      returnDocument: 'after',
    }).lean(),
  /** Unconditional patch (e.g. progress stage, cancel flag) scoped to the organization. */
  patch: (organizationId: Id, id: Id, patch: Record<string, unknown>) =>
    AiJobModel.findOneAndUpdate({ _id: id, organizationId }, patch, {
      returnDocument: 'after',
    }).lean(),
  async listPage(
    organizationId: Id,
    o: {
      limit: number;
      cursor?: string;
      matterId?: string;
      status?: string;
      task?: string;
      hiddenMatterIds: Id[];
    },
  ) {
    const filter: Record<string, unknown> = {
      organizationId,
      matterId: o.matterId ? o.matterId : { $nin: o.hiddenMatterIds },
      ...(o.status ? { status: o.status } : {}),
      ...(o.task ? { task: o.task } : {}),
      ...cursor(o.cursor),
    };
    const rows = await AiJobModel.find(filter)
      .sort({ _id: -1 })
      .limit(o.limit + 1)
      .lean();
    return toPage(rows, o.limit);
  },
};

export const aiOutputs = {
  create: async (data: Omit<AiOutputDoc, '_id' | 'createdAt'>) =>
    (await AiOutputModel.create(data)).toObject(),
  findById: (organizationId: Id, id: Id) =>
    AiOutputModel.findOne({ _id: id, organizationId }).lean(),
  findByJob: (organizationId: Id, jobId: Id) =>
    AiOutputModel.findOne({ organizationId, jobId }).lean(),
  async listPage(
    organizationId: Id,
    o: {
      limit: number;
      cursor?: string;
      matterId?: string;
      reviewStatus?: string;
      task?: string;
      hiddenMatterIds: Id[];
    },
  ) {
    const filter: Record<string, unknown> = {
      organizationId,
      matterId: o.matterId ? o.matterId : { $nin: o.hiddenMatterIds },
      ...(o.reviewStatus ? { reviewStatus: o.reviewStatus } : {}),
      ...(o.task ? { task: o.task } : {}),
      ...cursor(o.cursor),
    };
    const rows = await AiOutputModel.find(filter)
      .sort({ _id: -1 })
      .limit(o.limit + 1)
      .lean();
    return toPage(rows, o.limit);
  },
  /** Draft → approved/rejected, exactly once. Returns null if it was no longer a draft. */
  review: (
    organizationId: Id,
    id: Id,
    decision: 'approved' | 'rejected',
    reviewer: Id,
    note: string | null,
  ) =>
    AiOutputModel.findOneAndUpdate(
      { _id: id, organizationId, reviewStatus: 'draft' },
      { reviewStatus: decision, reviewedBy: reviewer, reviewedAt: new Date(), reviewNote: note },
      { returnDocument: 'after' },
    ).lean(),
  /** Only drafts can be edited; approved/rejected outputs are immutable. */
  saveEdit: (organizationId: Id, id: Id, text: string, editor: Id) =>
    AiOutputModel.findOneAndUpdate(
      { _id: id, organizationId, reviewStatus: 'draft' },
      { editedText: text, editedBy: editor, editedAt: new Date() },
      { returnDocument: 'after' },
    ).lean(),
};

/**
 * Whether `userId` may currently see the matter: an active member, and either the matter is
 * unrestricted, the user is on its access list, or the user is the organization owner.
 * Used by the worker to re-check access at processing time (access may change while a job waits).
 */
export async function userCanAccessMatter(
  organizationId: Id,
  matterId: Id,
  userId: Id,
): Promise<boolean> {
  const [matter, membership] = await Promise.all([
    MatterModel.findOne({ _id: matterId, organizationId }).select('restricted').lean(),
    MembershipModel.findOne({ organizationId, userId, status: 'active' }).select('role').lean(),
  ]);
  if (!matter || !membership) return false;
  if (!matter.restricted || membership.role === 'owner') return true;
  return (await MatterAccessModel.exists({ organizationId, matterId, userId })) !== null;
}
