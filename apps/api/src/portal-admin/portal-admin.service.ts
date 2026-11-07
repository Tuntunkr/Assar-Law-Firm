import { Injectable } from '@nestjs/common';
import {
  ClientUserModel,
  aiOutputs,
  clientUsers,
  clients,
  documentVersions,
  documents,
  mongoose,
  portalInvitations,
  sharing,
} from '@assar/database';
import type { z } from 'zod';
import type { createPortalInvitationSchema, setMatterPortalSchema } from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { randomToken, sha256 } from '../common/crypto';
import { ApiError } from '../common/exception.filter';
import { MatterAccessService } from '../matters/matter-access.service';
import { ClientSessionService } from '../portal/client-session.service';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const INVITE_TTL_MS = 7 * 24 * 3600_000;

@Injectable()
export class PortalAdminService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly clientSessions: ClientSessionService,
    private readonly audit: AuditService,
  ) {}

  private async activeClient(auth: AuthContext, clientId: string) {
    const c = await clients.findById(auth.organizationId, clientId);
    if (!c) throw new ApiError(404, 'NOT_FOUND', 'Client not found');
    return c;
  }

  // ---- who can sign in ----

  async invite(
    auth: AuthContext,
    clientId: string,
    input: z.infer<typeof createPortalInvitationSchema>,
    req: Req,
  ) {
    const client = await this.activeClient(auth, clientId);
    if (client.status !== 'active')
      throw new ApiError(409, 'CONFLICT', 'Archived clients cannot be given portal access');
    if (await clientUsers.findByEmail(auth.organizationId, input.email)) {
      throw new ApiError(409, 'CONFLICT', 'This email already has portal access');
    }
    const token = randomToken(32);
    const inv = await portalInvitations.create({
      organizationId: auth.organizationId,
      clientId,
      email: input.email,
      name: input.name,
      tokenHash: sha256(token),
      invitedBy: auth.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'portal.invitation_created',
      targetType: 'client',
      targetId: clientId,
      req,
    });
    // The raw token is returned once; until e-mail delivery exists the firm shares it with the client directly.
    return { id: String(inv._id), email: inv.email, expiresAt: inv.expiresAt, token };
  }

  async accessFor(auth: AuthContext, clientId: string) {
    await this.activeClient(auth, clientId);
    const [users, pending] = await Promise.all([
      clientUsers.listForClient(auth.organizationId, clientId),
      portalInvitations.listPending(auth.organizationId, clientId),
    ]);
    return {
      users: users.map((u) => ({
        id: String(u._id),
        email: u.email,
        name: u.name,
        status: u.status,
        lastLoginAt: u.lastLoginAt ?? null,
      })),
      invitations: pending.map((i) => ({
        id: String(i._id),
        email: i.email,
        expiresAt: i.expiresAt,
      })),
    };
  }

  async revokeInvitation(auth: AuthContext, clientId: string, id: string, req: Req) {
    if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'NOT_FOUND', 'Invitation not found');
    await this.activeClient(auth, clientId);
    if ((await portalInvitations.revoke(auth.organizationId, clientId, id)).deletedCount !== 1)
      throw new ApiError(404, 'NOT_FOUND', 'Invitation not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'portal.invitation_revoked',
      targetType: 'client',
      targetId: clientId,
      req,
    });
  }

  async setUserStatus(
    auth: AuthContext,
    clientId: string,
    userId: string,
    status: 'active' | 'disabled',
    req: Req,
  ) {
    await this.activeClient(auth, clientId);
    const user = await ClientUserModel.findOneAndUpdate(
      { _id: userId, organizationId: auth.organizationId, clientId }, // scoped to this client: no cross-client edits
      { status },
      { returnDocument: 'after' },
    ).lean();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'Portal user not found');
    if (status === 'disabled') await this.clientSessions.revokeAllForUser(userId);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'portal.user_status_changed',
      targetType: 'client_user',
      targetId: userId,
      req,
      meta: { status },
    });
    return { id: userId, status };
  }

  // ---- what they can see: everything is opt-in ----

  async setMatterPortal(
    auth: AuthContext,
    matterId: string,
    input: z.infer<typeof setMatterPortalSchema>,
    req: Req,
  ) {
    await this.access.load(auth, matterId, req);
    const m = await sharing.setMatterPortal(
      auth.organizationId,
      matterId,
      input.visible,
      input.note,
    );
    if (!m) throw new ApiError(404, 'NOT_FOUND', 'Matter not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: input.visible ? 'matter.published_to_portal' : 'matter.unpublished_from_portal',
      targetType: 'matter',
      targetId: matterId,
      req,
    });
    return { matterId, portalVisible: !!m.portalVisible, portalNote: m.portalNote ?? null };
  }

  async setVersionShared(
    auth: AuthContext,
    documentId: string,
    version: number,
    shared: boolean,
    req: Req,
  ) {
    const doc = await documents.findById(auth.organizationId, documentId);
    if (!doc || doc.status !== 'active') throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    await this.access.loadFor(auth, String(doc.matterId), req, 'Document not found');
    const v =
      Number.isInteger(version) && version > 0
        ? await documentVersions.find(auth.organizationId, doc._id, version)
        : null;
    if (!v) throw new ApiError(404, 'NOT_FOUND', 'Version not found');
    if (shared && v.status !== 'clean')
      throw new ApiError(
        409,
        'CONFLICT',
        'Only versions that passed the security scan can be shared',
      );
    await sharing.setVersionShared(auth.organizationId, doc._id, version, shared);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: shared ? 'document.shared_with_client' : 'document.unshared_from_client',
      targetType: 'document',
      targetId: documentId,
      req,
      meta: { version },
    });
    return { documentId, version, shared };
  }

  async setOutputShared(auth: AuthContext, outputId: string, shared: boolean, req: Req) {
    const out = await aiOutputs.findById(auth.organizationId, outputId);
    // Client-level summaries span matters and are private to their requester: never shareable.
    if (!out || !out.matterId) throw new ApiError(404, 'NOT_FOUND', 'AI output not found');
    await this.access.loadFor(auth, String(out.matterId), req, 'AI output not found');
    // Approval is a precondition; sharing is a separate, deliberate step.
    const updated = await sharing.setOutputShared(
      auth.organizationId,
      outputId,
      shared,
      auth.userId,
    );
    if (!updated)
      throw new ApiError(409, 'CONFLICT', 'Only approved AI outputs can be shared with a client');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: shared ? 'ai.output_shared_with_client' : 'ai.output_unshared_from_client',
      targetType: 'ai_output',
      targetId: outputId,
      req,
    });
    return { outputId, shared };
  }
}
