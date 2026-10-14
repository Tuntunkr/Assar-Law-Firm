import { Injectable } from '@nestjs/common';
import {
  UserModel,
  audit,
  invitations,
  memberships,
  mongoose,
  organizations,
} from '@assar/database';
import type { z } from 'zod';
import type {
  auditQuerySchema,
  createInvitationSchema,
  paginationSchema,
  updateMemberSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { randomToken, sha256 } from '../common/crypto';
import { ApiError } from '../common/exception.filter';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const INVITE_TTL_MS = 7 * 24 * 3600_000;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async get(auth: AuthContext) {
    const org = await organizations.findById(auth.organizationId);
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');
    return { id: String(org._id), name: org.name, slug: org.slug, status: org.status };
  }

  async rename(auth: AuthContext, name: string, req: Req) {
    const org = await organizations.update(auth.organizationId, { name });
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'organization.updated',
      targetType: 'organization',
      targetId: auth.organizationId,
      req,
    });
    return { id: String(org._id), name: org.name, slug: org.slug, status: org.status };
  }

  async listMembers(auth: AuthContext, q: z.infer<typeof paginationSchema>) {
    const page = await memberships.listPage(auth.organizationId, q.limit, q.cursor);
    const people = await UserModel.find({ _id: { $in: page.data.map((m) => m.userId) } })
      .select('email name lastLoginAt mfa.enabled')
      .lean();
    const byId = new Map(people.map((p) => [String(p._id), p]));
    return {
      data: page.data.map((m) => {
        const p = byId.get(String(m.userId));
        return {
          userId: String(m.userId),
          email: p?.email,
          name: p?.name,
          role: m.role,
          status: m.status,
          mfaEnabled: p?.mfa.enabled ?? false,
          lastLoginAt: p?.lastLoginAt ?? null,
        };
      }),
      page: page.page,
    };
  }

  async updateMember(
    auth: AuthContext,
    userId: string,
    input: z.infer<typeof updateMemberSchema>,
    req: Req,
  ) {
    if (!mongoose.isValidObjectId(userId)) throw new ApiError(404, 'NOT_FOUND', 'Member not found');
    const target = await memberships.find(auth.organizationId, userId); // org-scoped: other orgs' users are 404
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'Member not found');
    if (userId === auth.userId)
      throw new ApiError(403, 'FORBIDDEN', 'You cannot change your own role or status');
    if (target.role === 'owner')
      throw new ApiError(403, 'FORBIDDEN', 'Owner accounts cannot be modified here');
    const touchesAdmin = target.role === 'admin' || input.role === 'admin';
    if (touchesAdmin && auth.role !== 'owner')
      throw new ApiError(403, 'FORBIDDEN', 'Only the owner can manage administrators');

    const before = { role: target.role, status: target.status };
    if (input.role) target.role = input.role;
    if (input.status) target.status = input.status;
    await target.save();
    if (target.status === 'disabled' || target.role !== before.role)
      await this.sessions.revokeAllForUser(userId);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'member.updated',
      targetType: 'user',
      targetId: userId,
      req,
      meta: { before, after: { role: target.role, status: target.status } },
    });
    return { userId, role: target.role, status: target.status };
  }

  async createInvitation(
    auth: AuthContext,
    input: z.infer<typeof createInvitationSchema>,
    req: Req,
  ) {
    if (input.role === 'admin' && auth.role !== 'owner')
      throw new ApiError(403, 'FORBIDDEN', 'Only the owner can invite administrators');
    if (await UserModel.exists({ email: input.email }))
      throw new ApiError(409, 'CONFLICT', 'A user with this email already exists');
    const token = randomToken(32);
    const invite = await invitations.create({
      organizationId: auth.organizationId,
      email: input.email,
      role: input.role,
      tokenHash: sha256(token),
      invitedBy: auth.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'invitation.created',
      targetType: 'invitation',
      targetId: String(invite._id),
      req,
      meta: { role: input.role },
    });
    // The raw token is returned once; until email delivery exists (Phase 7) the admin shares it directly.
    return {
      id: String(invite._id),
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      token,
    };
  }

  async listInvitations(auth: AuthContext) {
    const rows = await invitations.listPending(auth.organizationId);
    return {
      data: rows.map((r) => ({
        id: String(r._id),
        email: r.email,
        role: r.role,
        expiresAt: r.expiresAt,
      })),
    };
  }

  async revokeInvitation(auth: AuthContext, id: string, req: Req) {
    if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'NOT_FOUND', 'Invitation not found');
    const res = await invitations.revoke(auth.organizationId, id);
    if (res.deletedCount !== 1) throw new ApiError(404, 'NOT_FOUND', 'Invitation not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'invitation.revoked',
      targetType: 'invitation',
      targetId: id,
      req,
    });
  }

  async auditLog(auth: AuthContext, q: z.infer<typeof auditQuerySchema>) {
    const page = await audit.listPage(auth.organizationId, q.limit, q.cursor, q.action);
    return {
      data: page.data.map((a) => ({
        id: String(a._id),
        action: a.action,
        actorId: a.actorId ? String(a.actorId) : null,
        targetType: a.targetType,
        targetId: a.targetId,
        ip: a.ip,
        requestId: a.requestId,
        meta: a.meta,
        createdAt: a.createdAt,
      })),
      page: page.page,
    };
  }
}
