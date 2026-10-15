import type { Types } from 'mongoose';
import { decodeCursor, toPage } from '../pagination.js';
import {
  AiOutputModel,
  CalendarEventModel,
  ClientUserModel,
  DocumentModel,
  DocumentVersionModel,
  MatterModel,
  MembershipModel,
  NotificationModel,
  PortalInvitationModel,
  ServiceTokenModel,
  TaskModel,
  UserModel,
  type NotificationDoc,
} from '../models/index.js';
import { InvalidCursorError } from './index.js';

type Id = Types.ObjectId | string;

// Every function takes organizationId first and applies it to the query.
// Portal queries additionally take clientId: a portal user can never reach another client's rows.

export const clientUsers = {
  create: async (data: {
    organizationId: Id;
    clientId: Id;
    email: string;
    name: string;
    passwordHash: string;
    createdBy: Id;
  }) => (await ClientUserModel.create(data)).toObject(),
  findByEmail: (organizationId: Id, email: string) =>
    ClientUserModel.findOne({ organizationId, email: email.toLowerCase() }),
  findById: (organizationId: Id, id: Id) => ClientUserModel.findOne({ _id: id, organizationId }),
  listForClient: (organizationId: Id, clientId: Id) =>
    ClientUserModel.find({ organizationId, clientId })
      .select('-passwordHash')
      .sort({ _id: -1 })
      .limit(200)
      .lean(),
};

export const portalInvitations = {
  create: async (data: {
    organizationId: Id;
    clientId: Id;
    email: string;
    name?: string;
    tokenHash: string;
    invitedBy: Id;
    expiresAt: Date;
  }) => (await PortalInvitationModel.create(data)).toObject(),
  findValidByTokenHash: (tokenHash: string) =>
    PortalInvitationModel.findOne({ tokenHash, acceptedAt: null, expiresAt: { $gt: new Date() } }),
  listPending: (organizationId: Id, clientId: Id) =>
    PortalInvitationModel.find({
      organizationId,
      clientId,
      acceptedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .select('-tokenHash')
      .sort({ _id: -1 })
      .lean(),
  revoke: (organizationId: Id, clientId: Id, id: Id) =>
    PortalInvitationModel.deleteOne({ _id: id, organizationId, clientId, acceptedAt: null }),
};

export const serviceTokens = {
  create: async (data: {
    organizationId: Id;
    name: string;
    prefix: string;
    tokenHash: string;
    scopes: string[];
    expiresAt: Date | null;
    createdBy: Id;
  }) => (await ServiceTokenModel.create(data)).toObject(),
  /** Token lookup is by hash alone; the stored organizationId then scopes everything that follows. */
  findByHash: (tokenHash: string) => ServiceTokenModel.findOne({ tokenHash }).lean(),
  list: (organizationId: Id) =>
    ServiceTokenModel.find({ organizationId })
      .select('-tokenHash')
      .sort({ _id: -1 })
      .limit(200)
      .lean(),
  revoke: (organizationId: Id, id: Id) =>
    ServiceTokenModel.findOneAndUpdate(
      { _id: id, organizationId, status: 'active' },
      { status: 'revoked', revokedAt: new Date() },
      { returnDocument: 'after' },
    ).lean(),
  touch: (id: Id) => ServiceTokenModel.updateOne({ _id: id }, { lastUsedAt: new Date() }),
};

export const notifications = {
  /** Idempotent when `dedupeKey` is given: returns `created: false` for a repeat. */
  async create(
    data: Pick<NotificationDoc, 'organizationId' | 'userId' | 'title'> & Partial<NotificationDoc>,
  ): Promise<{ notification: NotificationDoc; created: boolean }> {
    try {
      return { notification: (await NotificationModel.create(data)).toObject(), created: true };
    } catch (e) {
      if ((e as { code?: number }).code !== 11000 || !data.dedupeKey) throw e;
      const existing = await NotificationModel.findOne({
        organizationId: data.organizationId,
        dedupeKey: data.dedupeKey,
      }).lean();
      return { notification: existing as NotificationDoc, created: false };
    }
  },
  async listForUser(
    organizationId: Id,
    userId: Id,
    o: { limit: number; cursor?: string; unreadOnly?: boolean },
  ) {
    const c = decodeCursor(o.cursor);
    if (c === null) throw new InvalidCursorError();
    const filter: Record<string, unknown> = {
      organizationId,
      userId,
      ...(o.unreadOnly ? { readAt: null } : {}),
      ...(c ? { _id: { $lt: c } } : {}),
    };
    const rows = await NotificationModel.find(filter)
      .sort({ _id: -1 })
      .limit(o.limit + 1)
      .lean();
    return toPage(rows, o.limit);
  },
  unreadCount: (organizationId: Id, userId: Id) =>
    NotificationModel.countDocuments({ organizationId, userId, readAt: null }),
  markRead: (organizationId: Id, userId: Id, id: Id) =>
    NotificationModel.findOneAndUpdate(
      { _id: id, organizationId, userId },
      { $set: { readAt: new Date() } },
      { returnDocument: 'after' },
    ).lean(),
  markAllRead: (organizationId: Id, userId: Id) =>
    NotificationModel.updateMany(
      { organizationId, userId, readAt: null },
      { $set: { readAt: new Date() } },
    ),
};

/** What a portal user may see. A matter is visible only if it belongs to their client AND was published. */
export const portalQueries = {
  matters: (organizationId: Id, clientId: Id) =>
    MatterModel.find({ organizationId, clientId, portalVisible: true })
      .sort({ _id: -1 })
      .limit(200)
      .lean(),
  matter: (organizationId: Id, clientId: Id, id: Id) =>
    MatterModel.findOne({ _id: id, organizationId, clientId, portalVisible: true }).lean(),
  /** Active documents of the matter with at least one shared version, plus those versions. */
  async sharedDocuments(organizationId: Id, matterId: Id) {
    const versions = await DocumentVersionModel.find({
      organizationId,
      matterId,
      clientVisible: true,
    })
      .sort({ version: -1 })
      .limit(1000)
      .lean();
    if (versions.length === 0) return [];
    const docs = await DocumentModel.find({
      organizationId,
      matterId,
      status: 'active',
      _id: { $in: [...new Set(versions.map((v) => String(v.documentId)))] },
    })
      .sort({ _id: -1 })
      .lean();
    return docs.map((d) => ({
      doc: d,
      versions: versions.filter((v) => String(v.documentId) === String(d._id)),
    }));
  },
  sharedVersion: (organizationId: Id, documentId: Id, version: number) =>
    DocumentVersionModel.findOne({
      organizationId,
      documentId,
      version,
      clientVisible: true,
    }).lean(),
  /** Only outputs a reviewer approved AND someone then chose to share. */
  sharedAiOutputs: (organizationId: Id, matterId: Id) =>
    AiOutputModel.find({
      organizationId,
      matterId,
      reviewStatus: 'approved',
      sharedWithClient: true,
    })
      .sort({ _id: -1 })
      .limit(200)
      .lean(),
  sharedAiOutput: (organizationId: Id, matterId: Id, id: Id) =>
    AiOutputModel.findOne({
      _id: id,
      organizationId,
      matterId,
      reviewStatus: 'approved',
      sharedWithClient: true,
    }).lean(),
};

export const sharing = {
  setMatterPortal: (
    organizationId: Id,
    id: Id,
    visible: boolean,
    note: string | null | undefined,
  ) =>
    MatterModel.findOneAndUpdate(
      { _id: id, organizationId },
      { portalVisible: visible, ...(note !== undefined ? { portalNote: note } : {}) },
      { returnDocument: 'after' },
    ).lean(),
  setVersionShared: (organizationId: Id, documentId: Id, version: number, shared: boolean) =>
    DocumentVersionModel.findOneAndUpdate(
      { organizationId, documentId, version },
      { clientVisible: shared, clientSharedAt: shared ? new Date() : null },
      { returnDocument: 'after' },
    ).lean(),
  /** Only an approved output can be shared. */
  setOutputShared: (organizationId: Id, id: Id, shared: boolean, by: Id) =>
    AiOutputModel.findOneAndUpdate(
      { _id: id, organizationId, reviewStatus: 'approved' },
      {
        sharedWithClient: shared,
        sharedAt: shared ? new Date() : null,
        sharedBy: shared ? by : null,
      },
      { returnDocument: 'after' },
    ).lean(),
};

/** Read models for workflow automation. All exclude restricted matters unless a specific recipient is checked. */
export const automationQueries = {
  dueTasks: (organizationId: Id, from: Date, until: Date) =>
    TaskModel.find({
      organizationId,
      status: { $in: ['todo', 'in_progress'] },
      assigneeId: { $ne: null },
      dueAt: { $gte: from, $lte: until },
    })
      .sort({ dueAt: 1 })
      .limit(500)
      .lean(),
  dueEvents: (organizationId: Id, from: Date, until: Date) =>
    CalendarEventModel.find({
      organizationId,
      status: 'scheduled',
      startsAt: { $gte: from, $lt: until },
      'attendeeIds.0': { $exists: true },
    })
      .sort({ startsAt: 1 })
      .limit(500)
      .lean(),
  /** Owners and admins (active), used as recipients of the daily report. */
  reportRecipients: async (organizationId: Id) =>
    (
      await MembershipModel.find({
        organizationId,
        status: 'active',
        role: { $in: ['owner', 'admin'] },
      })
        .select('userId')
        .lean()
    ).map((m) => m.userId),
  userNames: async (ids: Id[]) =>
    new Map(
      (
        await UserModel.find({ _id: { $in: ids } })
          .select('name')
          .lean()
      ).map((u) => [String(u._id), u.name]),
    ),
  async dailyCounts(organizationId: Id, restrictedIds: Id[], now: Date, weekAhead: Date) {
    const notRestricted = { $nin: restrictedIds };
    const [openMatters, overdueTasks, upcomingDeadlines, pendingDrafts, scanFailures] =
      await Promise.all([
        MatterModel.countDocuments({
          organizationId,
          status: { $in: ['open', 'pending'] },
          restricted: false,
        }),
        TaskModel.countDocuments({
          organizationId,
          status: { $in: ['todo', 'in_progress'] },
          dueAt: { $ne: null, $lt: now },
          matterId: notRestricted,
        }),
        CalendarEventModel.countDocuments({
          organizationId,
          kind: 'deadline',
          status: 'scheduled',
          startsAt: { $gte: now, $lt: weekAhead },
          matterId: notRestricted,
        }),
        AiOutputModel.countDocuments({
          organizationId,
          reviewStatus: 'draft',
          matterId: notRestricted,
        }),
        DocumentVersionModel.countDocuments({
          organizationId,
          status: 'scan_failed',
          matterId: notRestricted,
        }),
      ]);
    return { openMatters, overdueTasks, upcomingDeadlines, pendingDrafts, scanFailures };
  },
};
