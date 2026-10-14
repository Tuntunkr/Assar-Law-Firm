import { Inject, Injectable } from '@nestjs/common';
import {
  InvitationModel,
  UserModel,
  invitations,
  memberships,
  mongoose,
  organizations,
  users,
  type UserDoc,
} from '@assar/database';
import { ROLE_PERMISSIONS, roleRequiresMfa, type Role } from '@assar/types';
import type { z } from 'zod';
import type {
  acceptInvitationSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { decryptSecret, encryptSecret, sha256 } from '../common/crypto';
import { ApiError } from '../common/exception.filter';
import { ENV, type Env } from '../config/env';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService, looksLikeRecovery } from './totp.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const invalid = () => new ApiError(401, 'UNAUTHENTICATED', 'Invalid email or password');

type Req = Pick<AppRequest, 'ip' | 'id' | 'headers'>;
type Oid = InstanceType<typeof mongoose.Types.ObjectId>;

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async register(input: z.infer<typeof registerSchema>, req: Req) {
    if (!this.env.REGISTRATION_ENABLED)
      throw new ApiError(403, 'FORBIDDEN', 'Registration is disabled');
    if (await users.findByEmail(input.email))
      throw new ApiError(409, 'CONFLICT', 'An account with this email already exists');

    const passwordHash = await this.passwords.hash(input.password);
    const slug = `${
      input.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'firm'
    }-${Math.random().toString(36).slice(2, 8)}`;
    const tx = await mongoose.startSession();
    let org!: Awaited<ReturnType<typeof organizations.create>>;
    let user!: Awaited<ReturnType<typeof users.create>>;
    try {
      await tx.withTransaction(async () => {
        org = await organizations.create({ name: input.organizationName, slug }, { session: tx });
        user = await users.create(
          { email: input.email, name: input.name, passwordHash },
          { session: tx },
        );
        await memberships.create(
          { organizationId: org._id, userId: user._id, role: 'owner' },
          { session: tx },
        );
      });
    } finally {
      await tx.endSession();
    }
    await this.audit.record({
      organizationId: String(org._id),
      actorId: String(user._id),
      action: 'organization.created',
      targetType: 'organization',
      targetId: String(org._id),
      req,
    });
    return this.startSession(user, String(org._id), 'owner', req);
  }

  async login(input: z.infer<typeof loginSchema>, req: Req) {
    const user = await users.findByEmail(input.email);
    const membership = user ? await memberships.findActiveForUser(user._id) : null;
    if (!user || !membership || user.status !== 'active') {
      await this.passwords.verifyDummy(input.password);
      throw invalid();
    }
    const orgId = String(membership.organizationId);
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ApiError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      await this.recordFailure(user, orgId, req);
      throw invalid();
    }
    if (user.mfa.enabled) {
      if (!input.mfaCode) throw new ApiError(401, 'MFA_REQUIRED', 'Enter your authentication code');
      if (!(await this.checkMfa(user, input.mfaCode))) {
        await this.recordFailure(user, orgId, req);
        throw invalid();
      }
    }
    await UserModel.updateOne(
      { _id: user._id },
      { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    );
    await this.audit.record({
      organizationId: orgId,
      actorId: String(user._id),
      action: 'auth.login',
      req,
    });
    return this.startSession(user, orgId, membership.role, req);
  }

  async logout(auth: AuthContext, req: Req) {
    await this.sessions.revoke(auth.sessionTokenHash);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'auth.logout',
      req,
    });
  }

  async me(auth: AuthContext) {
    const [user, org] = await Promise.all([
      users.findById(auth.userId),
      organizations.findById(auth.organizationId),
    ]);
    if (!user || !org) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    return {
      user: { id: String(user._id), email: user.email, name: user.name },
      organization: { id: String(org._id), name: org.name, slug: org.slug },
      role: auth.role,
      permissions: ROLE_PERMISSIONS[auth.role],
      mfa: { enabled: user.mfa.enabled, enrollmentRequired: auth.mfaEnrollmentRequired },
      csrfToken: auth.csrfToken,
    };
  }

  async changePassword(auth: AuthContext, input: z.infer<typeof changePasswordSchema>, req: Req) {
    const user = await users.findById(auth.userId);
    if (!user || !(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw new ApiError(403, 'FORBIDDEN', 'Current password is incorrect');
    }
    user.passwordHash = await this.passwords.hash(input.newPassword);
    await user.save();
    await this.sessions.revokeOthers(auth.userId, auth.sessionTokenHash);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'auth.password_changed',
      req,
    });
  }

  async acceptInvitation(input: z.infer<typeof acceptInvitationSchema>, req: Req) {
    const invite = await invitations.findValidByTokenHash(sha256(input.token));
    if (!invite) throw new ApiError(404, 'NOT_FOUND', 'Invitation is invalid or expired');
    if (await users.findByEmail(invite.email))
      throw new ApiError(409, 'CONFLICT', 'An account with this email already exists');

    const passwordHash = await this.passwords.hash(input.password);
    const tx = await mongoose.startSession();
    let userId = '';
    try {
      await tx.withTransaction(async () => {
        const claimed = await InvitationModel.updateOne(
          { _id: invite._id, acceptedAt: null },
          { acceptedAt: new Date() },
          { session: tx },
        );
        if (claimed.modifiedCount !== 1)
          throw new ApiError(404, 'NOT_FOUND', 'Invitation is invalid or expired');
        const user = await users.create(
          { email: invite.email, name: input.name, passwordHash },
          { session: tx },
        );
        await memberships.create(
          { organizationId: invite.organizationId, userId: user._id, role: invite.role },
          { session: tx },
        );
        userId = String(user._id);
      });
    } finally {
      await tx.endSession();
    }
    await this.audit.record({
      organizationId: String(invite.organizationId),
      actorId: userId,
      action: 'invitation.accepted',
      targetType: 'user',
      targetId: userId,
      req,
    });
  }

  // ---- MFA ----

  async mfaSetup(auth: AuthContext) {
    const user = await this.requireUser(auth.userId);
    if (user.mfa.enabled) throw new ApiError(409, 'CONFLICT', 'MFA is already enabled');
    const secret = this.totp.generateSecret();
    user.mfa.pendingSecretEnc = encryptSecret(secret, this.env.MFA_ENCRYPTION_KEY);
    await user.save();
    // The secret is shown once for manual entry; it is stored encrypted.
    return { otpauthUri: this.totp.uri(user.email, secret), secret };
  }

  async mfaEnable(auth: AuthContext, code: string, req: Req) {
    const user = await this.requireUser(auth.userId);
    if (user.mfa.enabled) throw new ApiError(409, 'CONFLICT', 'MFA is already enabled');
    if (!user.mfa.pendingSecretEnc) throw new ApiError(409, 'CONFLICT', 'Start MFA setup first');
    const secret = decryptSecret(user.mfa.pendingSecretEnc, this.env.MFA_ENCRYPTION_KEY);
    const step = this.totp.verify(secret, code);
    if (step === null) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid authentication code');
    const recovery = this.totp.newRecoveryCodes();
    user.mfa.enabled = true;
    user.mfa.secretEnc = user.mfa.pendingSecretEnc;
    user.mfa.pendingSecretEnc = null;
    user.mfa.recoveryHashes = recovery.hashes;
    user.mfa.lastUsedStep = step;
    await user.save();
    await this.sessions.revokeOthers(auth.userId, auth.sessionTokenHash);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'auth.mfa_enabled',
      req,
    });
    return { recoveryCodes: recovery.plain };
  }

  async mfaDisable(auth: AuthContext, input: { password: string; code: string }, req: Req) {
    if (roleRequiresMfa(auth.role))
      throw new ApiError(403, 'FORBIDDEN', 'MFA cannot be disabled for your role');
    const user = await this.requireUser(auth.userId);
    if (!user.mfa.enabled) throw new ApiError(409, 'CONFLICT', 'MFA is not enabled');
    if (
      !(await this.passwords.verify(user.passwordHash, input.password)) ||
      !(await this.checkMfa(user, input.code))
    ) {
      throw new ApiError(403, 'FORBIDDEN', 'Password or code is incorrect');
    }
    user.mfa.enabled = false;
    user.mfa.secretEnc = null;
    user.mfa.recoveryHashes = [];
    user.mfa.lastUsedStep = null;
    await user.save();
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'auth.mfa_disabled',
      req,
    });
  }

  // ---- internals ----

  private async requireUser(id: string) {
    const user = await users.findById(id);
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    return user;
  }

  private async startSession(
    user: UserDoc & { _id: Oid },
    organizationId: string,
    role: Role,
    req: Req,
  ) {
    const session = await this.sessions.create({
      userId: String(user._id),
      organizationId,
      mfaVerified: user.mfa.enabled,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const org = await organizations.findById(organizationId);
    return {
      session,
      body: {
        user: { id: String(user._id), email: user.email, name: user.name },
        organization: { id: organizationId, name: org?.name ?? '', slug: org?.slug ?? '' },
        role,
        permissions: ROLE_PERMISSIONS[role],
        mfa: {
          enabled: user.mfa.enabled,
          enrollmentRequired: roleRequiresMfa(role) && !user.mfa.enabled,
        },
        csrfToken: session.csrf,
      },
    };
  }

  /** Accepts a TOTP code (replay-protected) or a single-use recovery code. */
  private async checkMfa(user: { _id: Oid; mfa: UserDoc['mfa'] }, code: string): Promise<boolean> {
    if (!user.mfa.secretEnc) return false;
    if (looksLikeRecovery(code)) {
      const res = await UserModel.updateOne(
        { _id: user._id, 'mfa.recoveryHashes': this.totp.hashRecovery(code) },
        { $pull: { 'mfa.recoveryHashes': this.totp.hashRecovery(code) } },
      );
      return res.modifiedCount === 1;
    }
    const step = this.totp.verify(
      decryptSecret(user.mfa.secretEnc, this.env.MFA_ENCRYPTION_KEY),
      code,
    );
    if (step === null) return false;
    const res = await UserModel.updateOne(
      { _id: user._id, $or: [{ 'mfa.lastUsedStep': null }, { 'mfa.lastUsedStep': { $lt: step } }] },
      { $set: { 'mfa.lastUsedStep': step } },
    );
    return res.modifiedCount === 1;
  }

  private async recordFailure(user: { _id: Oid }, organizationId: string, req: Req) {
    const updated = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginCount: 1 } },
      { returnDocument: 'after' },
    );
    await this.audit.record({
      organizationId,
      actorId: String(user._id),
      action: 'auth.login_failed',
      req,
    });
    if (updated && updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      await UserModel.updateOne(
        { _id: user._id },
        { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
      );
      await this.audit.record({
        organizationId,
        actorId: String(user._id),
        action: 'auth.account_locked',
        req,
      });
    }
  }
}
