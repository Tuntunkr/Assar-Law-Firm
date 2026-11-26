import { hasPermission, istDate, istDaysUntil } from '@assar/types';
import type { Types } from 'mongoose';
import {
  DeadlineModel,
  MatterAccessModel,
  MatterModel,
  MembershipModel,
  OutboxModel,
  TaskModel,
  type DeadlineDoc,
  type OutboxDoc,
} from '../models/index.js';
import { notifications } from './portal.js';
import { userCanAccessMatter } from './ai.js';

type Id = Types.ObjectId | string;

const historyEntry = (actorId: Id, action: string, note?: string | null) => ({
  at: new Date(),
  actorId,
  action,
  note: note ?? null,
});

export const deadlines = {
  create: async (
    data: Pick<
      DeadlineDoc,
      | 'organizationId'
      | 'matterId'
      | 'kind'
      | 'title'
      | 'basisNote'
      | 'dueOn'
      | 'reminderDaysBefore'
      | 'escalateAfterDays'
      | 'createdBy'
    >,
  ) =>
    (
      await DeadlineModel.create({
        ...data,
        status: 'draft',
        history: [historyEntry(data.createdBy, 'drafted')],
      })
    ).toObject(),
  findById: (organizationId: Id, id: Id) =>
    DeadlineModel.findOne({ _id: id, organizationId }).lean(),
  list: (organizationId: Id, hiddenMatterIds: Id[]) =>
    DeadlineModel.find({ organizationId, matterId: { $nin: hiddenMatterIds } })
      .sort({ dueOn: 1, _id: 1 })
      .limit(200)
      .lean(),
  update: (organizationId: Id, id: Id, patch: Record<string, unknown>) =>
    DeadlineModel.findOneAndUpdate({ _id: id, organizationId }, patch, {
      returnDocument: 'after',
      runValidators: true,
    }).lean(),
};

export const outbox = {
  create: async (
    data: Omit<OutboxDoc, '_id' | 'createdAt' | 'updatedAt' | 'webhookEventIds' | 'attempts'>,
  ) => (await OutboxModel.create({ ...data, attempts: 0, webhookEventIds: [] })).toObject(),
  findById: (organizationId: Id, id: Id) => OutboxModel.findOne({ _id: id, organizationId }).lean(),
  list: (organizationId: Id, hiddenMatterIds: Id[]) =>
    OutboxModel.find({
      organizationId,
      $or: [{ matterId: null }, { matterId: { $nin: hiddenMatterIds } }],
    })
      .sort({ _id: -1 })
      .limit(100)
      .lean(),
  update: (organizationId: Id, id: Id, patch: Record<string, unknown>) =>
    OutboxModel.findOneAndUpdate({ _id: id, organizationId }, patch, {
      returnDocument: 'after',
      runValidators: true,
    }).lean(),
  findByProviderMessageId: (providerMessageId: string) =>
    OutboxModel.findOne({ providerMessageId }).lean(),
  /** Messages the firm has released. Drafts, rejections, and failures stay off the portal. */
  releasedForClient: (organizationId: Id, clientId: Id, matterId: Id) =>
    OutboxModel.find({
      organizationId,
      clientId,
      matterId,
      status: { $in: ['mock_delivered', 'accepted', 'sent', 'delivered', 'read', 'played'] },
    })
      .sort({ _id: -1 })
      .limit(50)
      .lean(),
};

export const matterIds = {
  all: async (organizationId: Id) =>
    (await MatterModel.find({ organizationId }).select('_id').lean()).map((m) => m._id),
};

/**
 * In-app only. One Kolkata day, one notice per person. Does not call a court, a model, or a messenger.
 */
export async function dispatchPracticeReminders(now: Date = new Date()): Promise<{
  deadlines: number;
  tasks: number;
  notified: number;
}> {
  const today = istDate(now);
  let deadlineCount = 0;
  let taskCount = 0;
  let notified = 0;

  const openDeadlines = await DeadlineModel.find({ status: 'approved' }).limit(5000).lean();
  for (const row of openDeadlines) {
    const days = istDaysUntil(row.dueOn, now);
    const remind = row.reminderDaysBefore.includes(days);
    const escalate = days < 0 && Math.abs(days) >= (row.escalateAfterDays ?? 1);
    if (!remind && !escalate) continue;
    deadlineCount++;
    const members = await MembershipModel.find({
      organizationId: row.organizationId,
      status: 'active',
    })
      .select('userId role')
      .lean();
    for (const member of members) {
      if (!hasPermission(member.role, 'deadline:approve')) continue;
      if (!(await userCanAccessMatter(row.organizationId, row.matterId, member.userId))) continue;
      const step = remind ? `due-${days}` : `escalate-${Math.abs(days)}`;
      const title = remind
        ? `Date ${row.title} is ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`
        : `Date ${row.title} is ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} past the typed date`;
      const r = await notifications.create({
        organizationId: row.organizationId,
        userId: member.userId,
        title,
        body: 'This is the date someone typed. It is not a statutory calculation and it was not sent to the client.',
        link: { type: 'deadline', id: String(row._id) },
        dedupeKey: `deadline:${row._id}:${step}:${member.userId}`,
        source: 'system',
      });
      if (r.created) notified++;
    }
  }

  const dueTasks = await TaskModel.find({
    status: { $in: ['todo', 'in_progress'] },
    assigneeId: { $ne: null },
    dueAt: { $ne: null, $lte: new Date(now.getTime() + 86_400_000) },
  })
    .limit(5000)
    .lean();
  for (const task of dueTasks) {
    const member = await MembershipModel.findOne({
      organizationId: task.organizationId,
      userId: task.assigneeId!,
      status: 'active',
    })
      .select('role')
      .lean();
    if (!member || member.role !== 'intern') continue;
    if (task.matterId) {
      const allowed = await MatterAccessModel.exists({
        organizationId: task.organizationId,
        matterId: task.matterId,
        userId: task.assigneeId!,
      });
      if (!allowed) continue;
    }
    taskCount++;
    const r = await notifications.create({
      organizationId: task.organizationId,
      userId: task.assigneeId!,
      title: `Task due: ${task.title}`,
      body: 'In-app reminder for a task assigned to you. Nothing was sent outside the firm.',
      link: { type: 'task', id: String(task._id) },
      dedupeKey: `task-due:${task._id}:${today}:${task.assigneeId}`,
      source: 'system',
    });
    if (r.created) notified++;
  }

  return { deadlines: deadlineCount, tasks: taskCount, notified };
}
