import { Injectable } from '@nestjs/common';
import {
  aiOutputs,
  automationQueries,
  calendar,
  documents,
  matterVisibility,
  matters,
  memberships,
  notifications,
  tasks,
  userCanAccessMatter,
} from '@assar/database';
import type { z } from 'zod';
import type { automationNotificationSchema, automationTaskSchema } from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, ServiceContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { assertActiveMembers } from '../common/members';
import { MatterAccessService } from '../matters/matter-access.service';
import { taskDto } from '../tasks/tasks.service';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const idStr = (v: unknown) => (v == null ? null : String(v));
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What automation (n8n) may do. A service token is not a user, so it never reads anything "as" someone:
 *  - it only receives item details together with a recipient who is entitled to see them;
 *  - it can attach work to a restricted matter only for a person who can see that matter;
 *  - restricted matters are left out of aggregate reports entirely.
 */
@Injectable()
export class AutomationService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
  ) {}

  private act(
    s: ServiceContext,
    action: string,
    req: Req,
    extra: { targetType?: string; targetId?: string; meta?: Record<string, unknown> } = {},
  ) {
    return this.audit.record({
      organizationId: s.organizationId,
      actorId: s.tokenId,
      actorType: 'service',
      action,
      req,
      ...extra,
    });
  }

  private async isEntitled(orgId: string, matterId: unknown, userId: string) {
    return matterId
      ? userCanAccessMatter(orgId, idStr(matterId)!, userId)
      : (await memberships.countActive(orgId, [userId])) === 1;
  }

  /** Items due soon, one row per entitled recipient. */
  async dueReminders(s: ServiceContext, windowHours: number, req: Req) {
    const now = new Date();
    const until = new Date(now.getTime() + windowHours * 3_600_000);
    const [dueTasks, dueEvents] = await Promise.all([
      automationQueries.dueTasks(s.organizationId, new Date(now.getTime() - 24 * 3_600_000), until),
      automationQueries.dueEvents(s.organizationId, now, until),
    ]);
    const items: {
      kind: 'task' | 'event';
      itemId: string;
      title: string;
      dueAt: Date;
      matterId: string | null;
      recipientUserId: string;
      dedupeKey: string;
    }[] = [];
    for (const t of dueTasks) {
      const r = idStr(t.assigneeId)!;
      if (t.dueAt && (await this.isEntitled(s.organizationId, t.matterId, r))) {
        items.push({
          kind: 'task',
          itemId: String(t._id),
          title: t.title,
          dueAt: t.dueAt,
          matterId: idStr(t.matterId),
          recipientUserId: r,
          dedupeKey: `task:${t._id}:${r}:${day(t.dueAt)}`,
        });
      }
    }
    for (const e of dueEvents) {
      for (const a of e.attendeeIds.map(String)) {
        if (await this.isEntitled(s.organizationId, e.matterId, a)) {
          items.push({
            kind: 'event',
            itemId: String(e._id),
            title: e.title,
            dueAt: e.startsAt,
            matterId: idStr(e.matterId),
            recipientUserId: a,
            dedupeKey: `event:${e._id}:${a}:${day(e.startsAt)}`,
          });
        }
      }
    }
    await this.act(s, 'automation.reminders_read', req, { meta: { items: items.length } });
    return { generatedAt: now, windowHours, items };
  }

  /** Resolves which matter (if any) a notification link points at, within the organization. */
  private async linkedMatter(
    orgId: string,
    link: { type: string; id: string },
  ): Promise<string | null> {
    const found =
      link.type === 'task'
        ? await tasks.findById(orgId, link.id)
        : link.type === 'event'
          ? await calendar.findById(orgId, link.id)
          : link.type === 'matter'
            ? await matters.findById(orgId, link.id)
            : link.type === 'ai_output'
              ? await aiOutputs.findById(orgId, link.id)
              : await documents.findById(orgId, link.id);
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'Linked item not found');
    return link.type === 'matter' ? link.id : idStr((found as { matterId?: unknown }).matterId);
  }

  async notify(s: ServiceContext, input: z.infer<typeof automationNotificationSchema>, req: Req) {
    const orgId = s.organizationId;
    await assertActiveMembers(orgId, [input.recipientUserId]);
    if (input.link) {
      const matterId = await this.linkedMatter(orgId, input.link);
      // A notification can never point a person at something they are not allowed to open.
      if (matterId && !(await userCanAccessMatter(orgId, matterId, input.recipientUserId))) {
        throw new ApiError(404, 'NOT_FOUND', 'Linked item not found');
      }
    }
    const { notification, created } = await notifications.create({
      organizationId: orgId as never,
      userId: input.recipientUserId as never,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      dedupeKey: input.dedupeKey,
      source: 'workflow',
    });
    if (created)
      await this.act(s, 'automation.notification_created', req, {
        targetType: 'notification',
        targetId: String(notification._id),
      });
    return { id: String(notification._id), created };
  }

  async createTask(s: ServiceContext, input: z.infer<typeof automationTaskSchema>, req: Req) {
    const orgId = s.organizationId;
    let matter = null;
    if (input.matterId) {
      matter = await matters.findById(orgId, input.matterId);
      if (!matter) throw new ApiError(404, 'NOT_FOUND', 'Matter not found');
      // Work on a restricted matter must go to someone who can see it.
      if (matter.restricted && !input.assigneeId) {
        throw new ApiError(
          400,
          'VALIDATION_FAILED',
          'Tasks on restricted matters must be assigned to a user with access',
        );
      }
    }
    if (input.assigneeId) {
      await assertActiveMembers(orgId, [input.assigneeId]);
      if (matter) await this.access.assertUserCanSee(orgId, matter, input.assigneeId);
    }
    const t = await tasks.create({
      organizationId: orgId as never,
      matterId: (input.matterId ?? null) as never,
      title: input.title,
      description: input.description,
      status: 'todo',
      priority: input.priority,
      assigneeId: (input.assigneeId ?? null) as never,
      dueAt: input.dueAt ?? null,
      completedAt: null,
      createdBy: s.tokenId as never,
      createdVia: 'workflow',
    });
    await this.act(s, 'automation.task_created', req, {
      targetType: 'task',
      targetId: String(t._id),
      meta: { matterId: input.matterId ?? null },
    });
    return taskDto(t);
  }

  /** Just enough for a workflow to decide whom to assign. Titles and numbers of restricted matters are withheld. */
  async matterContext(s: ServiceContext, id: string, req: Req) {
    const m = await matters.findById(s.organizationId, id);
    if (!m) throw new ApiError(404, 'NOT_FOUND', 'Matter not found');
    await this.act(s, 'automation.matter_context_read', req, {
      targetType: 'matter',
      targetId: id,
    });
    return {
      id: String(m._id),
      restricted: m.restricted,
      status: m.status,
      leadAttorneyId: idStr(m.leadAttorneyId),
      createdBy: String(m.createdBy),
      ...(m.restricted ? {} : { matterNumber: m.matterNumber, title: m.title }),
    };
  }

  /** Counts only. Restricted matters (and anything attached to them) are not included. */
  async dailyReport(s: ServiceContext, req: Req) {
    const now = new Date();
    const restrictedIds = await matterVisibility.restrictedIds(s.organizationId);
    const [counts, recipients] = await Promise.all([
      automationQueries.dailyCounts(
        s.organizationId,
        restrictedIds,
        now,
        new Date(now.getTime() + 7 * 86_400_000),
      ),
      automationQueries.reportRecipients(s.organizationId),
    ]);
    await this.act(s, 'automation.report_read', req);
    return {
      generatedAt: now,
      date: day(now),
      counts,
      recipients: recipients.map(String),
      restrictedMattersExcluded: true,
    };
  }
}
