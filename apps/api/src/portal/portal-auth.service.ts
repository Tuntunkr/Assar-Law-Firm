import { Injectable } from '@nestjs/common';
import {
  ClientUserModel,
  PortalInvitationModel,
  clientUsers,
  clients,
  mongoose,
  organizations,
  portalInvitations,
} from '@assar/database';
import type { PortalMe } from '@assar/types';
import type { z } from 'zod';
import type {
  changePasswordSchema,
  portalAcceptInvitationSchema,
  portalLoginSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import type { AppRequest, ClientContext } from '../common/auth-context';
import { sha256 } from '../common/crypto';
import { ApiError } from '../common/exception.filter';
import { ClientSessionService } from './client-session.service';

type Req = Pick<AppRequest, 'ip' | 'id' | 'headers'>;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const invalid = () => new ApiError(401, 'UNAUTHENTICATED', 'Invalid firm, email or password');

@Injectable()
export class PortalAuthService {
  constructor(
    private readonly passwords: PasswordService,
    private readonly sessions: ClientSessionService,
    private readonly audit: AuditService,
  ) {}

  private async profile(
    organizationId: string,
    clientUserId: string,
    csrfToken: string,
  ): Promise<PortalMe> {
    const [user, org] = await Promise.all([
      clientUsers.findById(organizationId, clientUserId),
      organizations.findById(organizationId),
    ]);
    const client = user ? await clients.findById(organizationId, user.clientId) : null;
    if (!user || !org || !client)
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    return {
      clientUser: { id: String(user._id), name: user.name, email: user.email },
      client: { id: String(client._id), name: client.name },
      organization: { name: org.name, slug: org.slug },
      csrfToken,
    };
  }

  me(c: ClientContext) {
    return this.profile(c.organizationId, c.clientUserId, c.csrfToken);
  }

  async login(input: z.infer<typeof portalLoginSchema>, req: Req) {
    const org = await organizations.findBySlug(input.organizationSlug);
    const user =
      org && org.status === 'active' ? await clientUsers.findByEmail(org._id, input.email) : null;
    const client = user ? await clients.findById(org!._id, user.clientId) : null;
    if (!org || !user || user.status !== 'active' || !client || client.status !== 'active') {
      await this.passwords.verifyDummy(input.password);
      throw invalid();
    }
    const orgId = String(org._id);
    const base = {
      organizationId: orgId,
      actorId: String(user._id),
      actorType: 'client' as const,
      req,
    };
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ApiError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      const updated = await ClientUserModel.findOneAndUpdate(
        { _id: user._id },
        { $inc: { failedLoginCount: 1 } },
        { returnDocument: 'after' },
      );
      await this.audit.record({ ...base, action: 'portal.login_failed' });
      if (updated && updated.failedLoginCount >= MAX_FAILED) {
        await ClientUserModel.updateOne(
          { _id: user._id },
          { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
        );
        await this.audit.record({ ...base, action: 'portal.account_locked' });
      }
      throw invalid();
    }
    await ClientUserModel.updateOne(
      { _id: user._id },
      { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    );
    const session = await this.sessions.create({
      clientUserId: String(user._id),
      organizationId: orgId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    await this.audit.record({ ...base, action: 'portal.login' });
    return { session, body: await this.profile(orgId, String(user._id), session.csrf) };
  }

  async logout(c: ClientContext, req: Req) {
    await this.sessions.revoke(c.sessionTokenHash);
    await this.audit.record({
      organizationId: c.organizationId,
      actorId: c.clientUserId,
      actorType: 'client',
      action: 'portal.logout',
      req,
    });
  }

  async changePassword(c: ClientContext, input: z.infer<typeof changePasswordSchema>, req: Req) {
    const user = await clientUsers.findById(c.organizationId, c.clientUserId);
    if (!user || !(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw new ApiError(403, 'FORBIDDEN', 'Current password is incorrect');
    }
    user.passwordHash = await this.passwords.hash(input.newPassword);
    await user.save();
    await this.sessions.revokeOthers(c.clientUserId, c.sessionTokenHash);
    await this.audit.record({
      organizationId: c.organizationId,
      actorId: c.clientUserId,
      actorType: 'client',
      action: 'portal.password_changed',
      req,
    });
  }

  async acceptInvitation(input: z.infer<typeof portalAcceptInvitationSchema>, req: Req) {
    const invite = await portalInvitations.findValidByTokenHash(sha256(input.token));
    if (!invite) throw new ApiError(404, 'NOT_FOUND', 'Invitation is invalid or expired');
    const client = await clients.findById(invite.organizationId, invite.clientId);
    if (!client || client.status !== 'active')
      throw new ApiError(404, 'NOT_FOUND', 'Invitation is invalid or expired');
    if (await clientUsers.findByEmail(invite.organizationId, invite.email)) {
      throw new ApiError(
        409,
        'CONFLICT',
        'An account with this email already exists for this firm',
      );
    }
    const passwordHash = await this.passwords.hash(input.password);
    const tx = await mongoose.startSession();
    let userId = '';
    try {
      await tx.withTransaction(async () => {
        const claimed = await PortalInvitationModel.updateOne(
          { _id: invite._id, acceptedAt: null },
          { acceptedAt: new Date() },
          { session: tx },
        );
        if (claimed.modifiedCount !== 1)
          throw new ApiError(404, 'NOT_FOUND', 'Invitation is invalid or expired');
        const [user] = await ClientUserModel.create(
          [
            {
              organizationId: invite.organizationId,
              clientId: invite.clientId,
              email: invite.email,
              name: input.name,
              passwordHash,
              createdBy: invite.invitedBy,
            },
          ],
          { session: tx },
        );
        userId = String(user!._id);
      });
    } finally {
      await tx.endSession();
    }
    await this.audit.record({
      organizationId: String(invite.organizationId),
      actorId: userId,
      actorType: 'client',
      action: 'portal.invitation_accepted',
      targetType: 'client',
      targetId: String(invite.clientId),
      req,
    });
  }
}
