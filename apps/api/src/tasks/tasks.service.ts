import { Injectable } from '@nestjs/common';
import { matterAccess, memberships, tasks, type TaskDoc } from '@assar/database';
import type { z } from 'zod';
import type { createTaskSchema, taskListQuerySchema, updateTaskSchema } from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { memberNames } from '../common/identity';
import { assertActiveMembers } from '../common/members';
import { MatterAccessService } from '../matters/matter-access.service';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const idStr = (v: unknown) => (v == null ? null : String(v));

const withAssignee = async (orgId: string, rows: TaskDoc[]) => {
  const names = await memberNames(
    orgId,
    rows.map((t) => idStr(t.assigneeId)),
  );
  return rows.map((t) => ({
    ...taskDto(t),
    assigneeName: names.get(String(t.assigneeId ?? '')) ?? null,
  }));
};

export const taskDto = (t: TaskDoc) => ({
  id: String(t._id),
  matterId: idStr(t.matterId),
  title: t.title,
  description: t.description ?? null,
  status: t.status,
  priority: t.priority,
  assigneeId: idStr(t.assigneeId),
  dueAt: t.dueAt ?? null,
  completedAt: t.completedAt ?? null,
  createdBy: String(t.createdBy),
  createdVia: t.createdVia ?? 'user',
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

@Injectable()
export class TasksService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
  ) {}

  private async checkAssignee(
    orgId: string,
    matter: Awaited<ReturnType<MatterAccessService['loadOptional']>>,
    assigneeId: string | null | undefined,
    actorId: string,
    req: Req,
  ) {
    if (!assigneeId) return;
    await assertActiveMembers(orgId, [assigneeId]);
    const member = await memberships.find(orgId, assigneeId);
    if (member?.role === 'intern' && matter) {
      await matterAccess.grant(orgId, matter._id, assigneeId, actorId);
      await this.audit.record({
        organizationId: orgId,
        actorId,
        action: 'matter.intern_assigned',
        targetType: 'matter',
        targetId: String(matter._id),
        req,
        meta: { assigneeId },
      });
      return;
    }
    if (matter) await this.access.assertUserCanSee(orgId, matter, assigneeId);
  }

  private async load(auth: AuthContext, id: string, req: Req) {
    const t = await tasks.findById(auth.organizationId, id);
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
    if (auth.role === 'intern' && idStr(t.assigneeId) !== auth.userId)
      throw new ApiError(404, 'NOT_FOUND', 'Task not found');
    const matter = await this.access.loadFor(auth, idStr(t.matterId), req, 'Task not found');
    return { task: t, matter };
  }

  async create(auth: AuthContext, input: z.infer<typeof createTaskSchema>, req: Req) {
    if (auth.role === 'intern')
      throw new ApiError(403, 'FORBIDDEN', 'An intern cannot create tasks');
    const matter = await this.access.loadOptional(auth, input.matterId, req);
    await this.checkAssignee(auth.organizationId, matter, input.assigneeId, auth.userId, req);
    const t = await tasks.create({
      organizationId: auth.organizationId as never,
      matterId: (input.matterId ?? null) as never,
      title: input.title,
      description: input.description,
      status: 'todo',
      priority: input.priority,
      assigneeId: (input.assigneeId ?? null) as never,
      dueAt: input.dueAt ?? null,
      completedAt: null,
      createdBy: auth.userId as never,
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'task.created',
      targetType: 'task',
      targetId: String(t._id),
      req,
      meta: { matterId: idStr(t.matterId), assigneeId: idStr(t.assigneeId) },
    });
    return (await withAssignee(auth.organizationId, [t]))[0]!;
  }

  async list(auth: AuthContext, q: z.infer<typeof taskListQuerySchema>, req: Req) {
    if (q.matterId) await this.access.load(auth, q.matterId, req);
    const hiddenMatterIds = q.matterId ? [] : await this.access.hiddenMatterIds(auth);
    const assigneeId =
      auth.role === 'intern' ? auth.userId : q.assigneeId === 'me' ? auth.userId : q.assigneeId;
    const page = await tasks.listPage(auth.organizationId, {
      ...q,
      assigneeId,
      hiddenMatterIds,
    });
    return { data: await withAssignee(auth.organizationId, page.data), page: page.page };
  }

  async get(auth: AuthContext, id: string, req: Req) {
    return (await withAssignee(auth.organizationId, [(await this.load(auth, id, req)).task]))[0]!;
  }

  async update(auth: AuthContext, id: string, patch: z.infer<typeof updateTaskSchema>, req: Req) {
    if (auth.role === 'intern') {
      const allowed = Object.keys(patch).every((k) => k === 'status');
      if (!allowed)
        throw new ApiError(
          403,
          'FORBIDDEN',
          'An intern can only change the status of an assigned task',
        );
    }
    const { task, matter } = await this.load(auth, id, req);
    const targetMatter =
      patch.matterId !== undefined
        ? await this.access.loadOptional(auth, patch.matterId, req)
        : matter;
    // Re-check the assignee whenever the matter or the assignee changes.
    if (patch.matterId !== undefined || patch.assigneeId !== undefined) {
      await this.checkAssignee(
        auth.organizationId,
        targetMatter,
        patch.assigneeId === undefined ? idStr(task.assigneeId) : patch.assigneeId,
        auth.userId,
        req,
      );
    }
    const set: Record<string, unknown> = { ...patch };
    if (patch.status && patch.status !== task.status)
      set.completedAt = patch.status === 'done' ? new Date() : null;

    const updated = await tasks.update(auth.organizationId, id, set);
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'task.updated',
      targetType: 'task',
      targetId: id,
      req,
      meta: { fields: Object.keys(patch) },
    });
    return (await withAssignee(auth.organizationId, [updated]))[0]!;
  }

  async remove(auth: AuthContext, id: string, req: Req) {
    await this.load(auth, id, req);
    await tasks.delete(auth.organizationId, id);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'task.deleted',
      targetType: 'task',
      targetId: id,
      req,
    });
  }
}
