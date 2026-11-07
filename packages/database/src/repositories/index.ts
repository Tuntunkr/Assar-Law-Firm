import type { ClientSession, Types } from 'mongoose';
import type { Role } from '@assar/types';
import { decodeCursor, toPage } from '../pagination.js';
import {
  AuditLogModel,
  IdempotencyKeyModel,
  InvitationModel,
  MembershipModel,
  OrganizationModel,
  SessionModel,
  UserModel,
  type AuditLogDoc,
} from '../models/index.js';

type Id = Types.ObjectId | string;
type Tx = { session?: ClientSession };

export const organizations = {
  findById: (id: Id) => OrganizationModel.findById(id).lean(),
  findBySlug: (slug: string) => OrganizationModel.findOne({ slug }).lean(),
  create: async (data: { name: string; slug: string }, tx: Tx = {}) =>
    (await OrganizationModel.create([data], tx))[0]!,
  update: (id: Id, data: { name?: string }) =>
    OrganizationModel.findByIdAndUpdate(id, data, {
      returnDocument: 'after',
      runValidators: true,
    }).lean(),
};

export const users = {
  findById: (id: Id) => UserModel.findById(id),
  findByEmail: (email: string) => UserModel.findOne({ email: email.toLowerCase() }),
  create: async (data: { email: string; name: string; passwordHash: string }, tx: Tx = {}) =>
    (await UserModel.create([data], tx))[0]!,
};

export const memberships = {
  create: async (data: { organizationId: Id; userId: Id; role: Role }, tx: Tx = {}) =>
    (await MembershipModel.create([data], tx))[0]!,
  findActiveForUser: (userId: Id) => MembershipModel.findOne({ userId, status: 'active' }).lean(),
  /** All queries below require organizationId — never query memberships without it. */
  find: (organizationId: Id, userId: Id) => MembershipModel.findOne({ organizationId, userId }),
  countActive: (organizationId: Id, userIds: Id[]) =>
    MembershipModel.countDocuments({ organizationId, userId: { $in: userIds }, status: 'active' }),
  countActiveWithRole: (organizationId: Id, role: Role) =>
    MembershipModel.countDocuments({ organizationId, role, status: 'active' }),
  async listPage(organizationId: Id, limit: number, cursor?: string) {
    const c = decodeCursor(cursor);
    if (c === null) throw new InvalidCursorError();
    const rows = await MembershipModel.find({ organizationId, ...(c ? { _id: { $lt: c } } : {}) })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    return toPage(rows, limit);
  },
};

export const sessions = {
  create: async (data: Parameters<typeof SessionModel.create>[0]) => SessionModel.create(data),
  findByTokenHash: (tokenHash: string) => SessionModel.findOne({ tokenHash }),
  deleteByTokenHash: (tokenHash: string) => SessionModel.deleteOne({ tokenHash }),
  touch: (id: Id, lastSeenAt: Date, idleExpiresAt: Date) =>
    SessionModel.updateOne({ _id: id }, { lastSeenAt, idleExpiresAt }),
  /** Active staff sessions of one user, newest activity first. */
  listForUser: (userId: Id) =>
    SessionModel.find({
      userId,
      principal: { $ne: 'client' },
      absoluteExpiresAt: { $gt: new Date() },
    })
      .sort({ lastSeenAt: -1 })
      .lean(),
  deleteOneForUser: (userId: Id, id: Id) => SessionModel.deleteOne({ _id: id, userId }),
  deleteAllForUser: (userId: Id) => SessionModel.deleteMany({ userId }),
  deleteOthersForUser: (userId: Id, keepTokenHash: string) =>
    SessionModel.deleteMany({ userId, tokenHash: { $ne: keepTokenHash } }),
};

export const invitations = {
  create: async (data: {
    organizationId: Id;
    email: string;
    role: Exclude<Role, 'owner'>;
    tokenHash: string;
    invitedBy: Id;
    expiresAt: Date;
  }) => InvitationModel.create(data),
  findValidByTokenHash: (tokenHash: string) =>
    InvitationModel.findOne({ tokenHash, acceptedAt: null, expiresAt: { $gt: new Date() } }),
  listPending: (organizationId: Id) =>
    InvitationModel.find({ organizationId, acceptedAt: null, expiresAt: { $gt: new Date() } })
      .select('-tokenHash')
      .sort({ _id: -1 })
      .lean(),
  revoke: (organizationId: Id, id: Id) =>
    InvitationModel.deleteOne({ _id: id, organizationId, acceptedAt: null }),
};

export const audit = {
  record: (entry: Omit<AuditLogDoc, '_id' | 'createdAt'>) =>
    AuditLogModel.create({
      ...entry,
      actorType: entry.actorType ?? (entry.actorId ? 'staff' : 'system'),
    }),
  async listPage(organizationId: Id, limit: number, cursor?: string, action?: string) {
    const c = decodeCursor(cursor);
    if (c === null) throw new InvalidCursorError();
    const rows = await AuditLogModel.find({
      organizationId,
      ...(action ? { action } : {}),
      ...(c ? { _id: { $lt: c } } : {}),
    })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    return toPage(rows, limit);
  },
};

export const idempotency = {
  /** Returns the existing record, or null if this call created it (and now owns it). */
  async begin(organizationId: Id, key: string, requestHash: string, ttlMs = 24 * 3600_000) {
    try {
      await IdempotencyKeyModel.create({
        organizationId,
        key,
        requestHash,
        status: 'processing',
        expiresAt: new Date(Date.now() + ttlMs),
      });
      return null;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      return IdempotencyKeyModel.findOne({ organizationId, key }).lean();
    }
  },
  complete: (organizationId: Id, key: string, responseStatus: number, responseBody: unknown) =>
    IdempotencyKeyModel.updateOne(
      { organizationId, key },
      { status: 'completed', responseStatus, responseBody },
    ),
  release: (organizationId: Id, key: string) =>
    IdempotencyKeyModel.deleteOne({ organizationId, key, status: 'processing' }),
};

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
  }
}
export * from './crm.js';
export * from './work.js';
export * from './ai.js';
export * from './portal.js';
export * from './billing.js';
export * from './timeline.js';
export * from './templates.js';
export * from './reminders.js';
