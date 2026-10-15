import { Injectable } from '@nestjs/common';
import { tasks, type TaskDoc } from '@assar/database';
import type { z } from 'zod';
import type { createTaskSchema, taskListQuerySchema, updateTaskSchema } from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { assertActiveMembers } from '../common/members';
import { MatterAccessService } from '../matters/matter-access.service';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const idStr = (v: unknown) => (v == null ? null : String(v));

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
  ) {
    if (!assigneeId) return;
    await assertActiveMembers(orgId, [assigneeId]);
    if (matter) await this.access.assertUserCanSee(orgId, matter, assigneeId);
  }

  private async load(auth: AuthContext, id: string, req: Req) {
    const t = await tasks.findById(auth.organizationId, id);
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
    const matter = await this.access.loadFor(auth, idStr(t.matterId), req, 'Task not found');
    return { task: t, matter };
  }

  async create(auth: AuthContext, input: z.infer<typeof createTaskSchema>, req: Req) {
    const matter = await this.access.loadOptional(auth, input.matterId, req);
    await this.checkAssignee(auth.organizationId, matter, input.assigneeId);
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
    return taskDto(t);
  }

  async list(auth: AuthContext, q: z.infer<typeof taskListQuerySchema>, req: Req) {
    if (q.matterId) await this.access.load(auth, q.matterId, req);
    const hiddenMatterIds = q.matterId ? [] : await this.access.hiddenMatterIds(auth);
    const page = await tasks.listPage(auth.organizationId, {
      ...q,
      assigneeId: q.assigneeId === 'me' ? auth.userId : q.assigneeId,
      hiddenMatterIds,
    });
    return { data: page.data.map(taskDto), page: page.page };
  }

  async get(auth: AuthContext, id: string, req: Req) {
    return taskDto((await this.load(auth, id, req)).task);
  }

  async update(auth: AuthContext, id: string, patch: z.infer<typeof updateTaskSchema>, req: Req) {
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
    return taskDto(updated);
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
