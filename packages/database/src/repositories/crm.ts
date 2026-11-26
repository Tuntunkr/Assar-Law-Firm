import type { ClientSession, Types } from 'mongoose';
import { decodeCursor, toPage } from '../pagination.js';
import { nameTokens, normalizeName } from '../names.js';
import {
  ClientModel,
  ConflictCheckModel,
  CounterModel,
  MatterAccessModel,
  MatterModel,
  PartyModel,
  TeamModel,
  type ClientDoc,
  type MatterDoc,
  type PartyDoc,
} from '../models/index.js';
import { InvalidCursorError } from './index.js';

type Id = Types.ObjectId | string;
type Tx = { session?: ClientSession };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function cursorFilter(cursor?: string) {
  const c = decodeCursor(cursor);
  if (c === null) throw new InvalidCursorError();
  return c ? { _id: { $lt: c } } : {};
}
const nameFields = (name: string) => ({
  name,
  normalizedName: normalizeName(name),
  tokens: nameTokens(name),
});

// Every function takes organizationId first and applies it to the query — never query these without it.

export const clients = {
  create: async (
    organizationId: Id,
    createdBy: Id,
    data: Pick<ClientDoc, 'type' | 'name'> & Partial<ClientDoc>,
  ) =>
    (
      await ClientModel.create({ ...data, ...nameFields(data.name), organizationId, createdBy })
    ).toObject(),
  findById: (organizationId: Id, id: Id) => ClientModel.findOne({ _id: id, organizationId }).lean(),
  update: (organizationId: Id, id: Id, patch: Partial<ClientDoc>) =>
    ClientModel.findOneAndUpdate(
      { _id: id, organizationId },
      { ...patch, ...(patch.name ? nameFields(patch.name) : {}) },
      { returnDocument: 'after', runValidators: true },
    ).lean(),
  async listPage(
    organizationId: Id,
    o: { limit: number; cursor?: string; q?: string; status?: string },
  ) {
    const filter: Record<string, unknown> = {
      organizationId,
      ...(o.status ? { status: o.status } : {}),
      // A query with no searchable characters (e.g. ".*") matches nothing rather than everything.
      ...(o.q
        ? normalizeName(o.q)
          ? { normalizedName: { $regex: `^${escapeRegex(normalizeName(o.q))}` } }
          : { normalizedName: { $in: [] } }
        : {}),
      ...cursorFilter(o.cursor),
    };
    const rows = await ClientModel.find(filter)
      .sort({ _id: -1 })
      .limit(o.limit + 1)
      .lean();
    return toPage(rows, o.limit);
  },
  candidatesByTokens: (organizationId: Id, tokens: string[]) =>
    ClientModel.find({ organizationId, tokens: { $in: tokens } })
      .limit(200)
      .lean(),
};

export const matters = {
  async nextNumber(organizationId: Id, tx: Tx = {}): Promise<string> {
    const c = await CounterModel.findOneAndUpdate(
      { _id: `matter:${organizationId}` },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', ...tx },
    );
    return `M-${new Date().getUTCFullYear()}-${String(c!.seq).padStart(5, '0')}`;
  },
  create: async (
    data: Omit<MatterDoc, '_id' | 'createdAt' | 'updatedAt' | 'titleLower'>,
    tx: Tx = {},
  ) =>
    (
      await MatterModel.create([{ ...data, titleLower: data.title.toLowerCase() }], tx)
    )[0]!.toObject(),
  findById: (organizationId: Id, id: Id) => MatterModel.findOne({ _id: id, organizationId }).lean(),
  /** Ids of every matter belonging to a client (any status). */
  idsForClient: async (organizationId: Id, clientId: Id) =>
    (await MatterModel.find({ organizationId, clientId }).select('_id').lean()).map((m) => m._id),
  /** Just enough to label a list of items with their matter. */
  summaries: (organizationId: Id, ids: Id[]) =>
    MatterModel.find({ organizationId, _id: { $in: ids } })
      .select('matterNumber title clientId')
      .lean(),
  update: (organizationId: Id, id: Id, patch: Record<string, unknown>, tx: Tx = {}) =>
    MatterModel.findOneAndUpdate(
      { _id: id, organizationId },
      {
        ...patch,
        ...(typeof patch.title === 'string' ? { titleLower: patch.title.toLowerCase() } : {}),
      },
      { returnDocument: 'after', runValidators: true, ...tx },
    ).lean(),
  /**
   * `restrictedVisibleIds`: restricted matters the caller may see. `'all'` skips the restriction filter
   * (owner). Unrestricted matters are always included.
   */
  async listPage(
    organizationId: Id,
    o: {
      limit: number;
      cursor?: string;
      status?: string;
      clientId?: string;
      q?: string;
      restrictedVisibleIds: Id[] | 'all';
      /** When set, the caller sees only these matters (interns). */
      assignedOnlyIds?: Id[];
    },
  ) {
    const and: Record<string, unknown>[] = [];
    if (o.assignedOnlyIds) {
      and.push({ _id: { $in: o.assignedOnlyIds } });
    } else if (o.restrictedVisibleIds !== 'all') {
      and.push({ $or: [{ restricted: false }, { _id: { $in: o.restrictedVisibleIds } }] });
    }
    if (o.q) {
      and.push({
        $or: [
          { titleLower: { $regex: `^${escapeRegex(o.q.toLowerCase())}` } },
          { matterNumber: o.q.toUpperCase() },
        ],
      });
    }
    const filter: Record<string, unknown> = {
      organizationId,
      ...(o.status ? { status: o.status } : {}),
      ...(o.clientId ? { clientId: o.clientId } : {}),
      ...(and.length ? { $and: and } : {}),
      ...cursorFilter(o.cursor),
    };
    const rows = await MatterModel.find(filter)
      .sort({ _id: -1 })
      .limit(o.limit + 1)
      .lean();
    return toPage(rows, o.limit);
  },
  removeTeamEverywhere: (organizationId: Id, teamId: Id) =>
    MatterModel.updateMany({ organizationId, teamIds: teamId }, { $pull: { teamIds: teamId } }),
};

export const matterAccess = {
  userIdsFor: async (organizationId: Id, matterId: Id) =>
    (await MatterAccessModel.find({ organizationId, matterId }).select('userId').lean()).map(
      (r) => r.userId,
    ),
  matterIdsFor: async (organizationId: Id, userId: Id) =>
    (await MatterAccessModel.find({ organizationId, userId }).select('matterId').lean()).map(
      (r) => r.matterId,
    ),
  has: async (organizationId: Id, matterId: Id, userId: Id) =>
    (await MatterAccessModel.exists({ organizationId, matterId, userId })) !== null,
  grant: (organizationId: Id, matterId: Id, userId: Id, grantedBy: Id) =>
    MatterAccessModel.updateOne(
      { organizationId, matterId, userId },
      { $setOnInsert: { organizationId, matterId, userId, grantedBy } },
      { upsert: true },
    ),
  async replace(organizationId: Id, matterId: Id, userIds: Id[], grantedBy: Id, tx: Tx = {}) {
    await MatterAccessModel.deleteMany({ organizationId, matterId }, tx);
    if (userIds.length > 0) {
      await MatterAccessModel.insertMany(
        userIds.map((userId) => ({ organizationId, matterId, userId, grantedBy })),
        tx,
      );
    }
  },
};

export const parties = {
  create: async (
    organizationId: Id,
    matterId: Id,
    data: Pick<PartyDoc, 'name' | 'type' | 'role'> & Partial<PartyDoc>,
  ) =>
    (
      await PartyModel.create({ ...data, ...nameFields(data.name), organizationId, matterId })
    ).toObject(),
  listForMatter: (organizationId: Id, matterId: Id) =>
    PartyModel.find({ organizationId, matterId }).sort({ _id: 1 }).limit(500).lean(),
  update: (organizationId: Id, matterId: Id, id: Id, patch: Partial<PartyDoc>) =>
    PartyModel.findOneAndUpdate(
      { _id: id, organizationId, matterId },
      { ...patch, ...(patch.name ? nameFields(patch.name) : {}) },
      { returnDocument: 'after', runValidators: true },
    ).lean(),
  delete: (organizationId: Id, matterId: Id, id: Id) =>
    PartyModel.deleteOne({ _id: id, organizationId, matterId }),
  candidatesByTokens: (organizationId: Id, tokens: string[]) =>
    PartyModel.find({ organizationId, tokens: { $in: tokens } })
      .limit(200)
      .lean(),
};

export const teams = {
  create: async (
    organizationId: Id,
    createdBy: Id,
    data: { name: string; description?: string; userIds: Id[] },
  ) =>
    (
      await TeamModel.create({
        ...data,
        normalizedName: normalizeName(data.name),
        organizationId,
        createdBy,
      })
    ).toObject(),
  findById: (organizationId: Id, id: Id) => TeamModel.findOne({ _id: id, organizationId }).lean(),
  list: (organizationId: Id) =>
    TeamModel.find({ organizationId }).sort({ normalizedName: 1 }).limit(200).lean(),
  update: (
    organizationId: Id,
    id: Id,
    patch: { name?: string; description?: string; userIds?: Id[] },
  ) =>
    TeamModel.findOneAndUpdate(
      { _id: id, organizationId },
      { ...patch, ...(patch.name ? { normalizedName: normalizeName(patch.name) } : {}) },
      { returnDocument: 'after', runValidators: true },
    ).lean(),
  delete: (organizationId: Id, id: Id) => TeamModel.deleteOne({ _id: id, organizationId }),
  countIn: (organizationId: Id, ids: Id[]) =>
    TeamModel.countDocuments({ organizationId, _id: { $in: ids } }),
  /** Names of teams that already belong to this organization. No member roster. */
  displayNames: (organizationId: Id, ids: Id[]) =>
    TeamModel.find({ organizationId, _id: { $in: ids } })
      .select('name')
      .lean(),
};

export const conflictChecks = {
  record: (data: {
    organizationId: Id;
    requestedBy: Id;
    names: string[];
    matchCount: number;
    includesRestricted: boolean;
  }) => ConflictCheckModel.create(data),
};
