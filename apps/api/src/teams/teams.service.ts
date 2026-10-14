import { Injectable } from '@nestjs/common';
import { matters, teams } from '@assar/database';
import type { z } from 'zod';
import type { createTeamSchema, setTeamMembersSchema, updateTeamSchema } from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { assertActiveMembers } from '../common/members';

type Req = Pick<AppRequest, 'ip' | 'id'>;
type TeamRow = NonNullable<Awaited<ReturnType<typeof teams.findById>>>;

const teamDto = (t: TeamRow) => ({
  id: String(t._id),
  name: t.name,
  description: t.description ?? null,
  userIds: t.userIds.map(String),
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

/**
 * Teams group people for assignment and filtering. Membership of a team does NOT grant access to
 * restricted matters; that is controlled only by each matter's access list.
 */
@Injectable()
export class TeamsService {
  constructor(private readonly audit: AuditService) {}

  async create(auth: AuthContext, input: z.infer<typeof createTeamSchema>, req: Req) {
    await assertActiveMembers(auth.organizationId, input.userIds);
    const t = await teams.create(auth.organizationId, auth.userId, {
      ...input,
      userIds: [...new Set(input.userIds)],
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'team.created',
      targetType: 'team',
      targetId: String(t._id),
      req,
    });
    return teamDto(t);
  }

  async list(auth: AuthContext) {
    return { data: (await teams.list(auth.organizationId)).map(teamDto) };
  }

  async get(auth: AuthContext, id: string) {
    const t = await teams.findById(auth.organizationId, id);
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Team not found');
    return teamDto(t);
  }

  async update(auth: AuthContext, id: string, patch: z.infer<typeof updateTeamSchema>, req: Req) {
    const t = await teams.update(auth.organizationId, id, patch);
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Team not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'team.updated',
      targetType: 'team',
      targetId: id,
      req,
      meta: { fields: Object.keys(patch) },
    });
    return teamDto(t);
  }

  async setMembers(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof setTeamMembersSchema>,
    req: Req,
  ) {
    await assertActiveMembers(auth.organizationId, input.userIds);
    const t = await teams.update(auth.organizationId, id, { userIds: [...new Set(input.userIds)] });
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Team not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'team.members_changed',
      targetType: 'team',
      targetId: id,
      req,
      meta: { count: t.userIds.length },
    });
    return teamDto(t);
  }

  async remove(auth: AuthContext, id: string, req: Req) {
    const res = await teams.delete(auth.organizationId, id);
    if (res.deletedCount !== 1) throw new ApiError(404, 'NOT_FOUND', 'Team not found');
    await matters.removeTeamEverywhere(auth.organizationId, id);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'team.deleted',
      targetType: 'team',
      targetId: id,
      req,
    });
  }
}
