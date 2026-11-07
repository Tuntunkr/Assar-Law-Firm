import { Inject, Injectable } from '@nestjs/common';
import { memberships, sessions, users } from '@assar/database';
import { roleRequiresMfa } from '@assar/types';
import type { AuthContext } from '../common/auth-context';
import { hmac, randomToken, sha256 } from '../common/crypto';
import { ENV, type Env } from '../config/env';

@Injectable()
export class SessionService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  csrfFor(rawToken: string): string {
    return hmac(this.env.SESSION_SECRET, rawToken);
  }

  async create(input: {
    userId: string;
    organizationId: string;
    mfaVerified: boolean;
    ip?: string;
    userAgent?: string;
  }) {
    const raw = randomToken(32);
    const now = new Date();
    const absolute = new Date(now.getTime() + this.env.SESSION_ABSOLUTE_HOURS * 3600_000);
    const idle = new Date(
      Math.min(now.getTime() + this.env.SESSION_IDLE_MINUTES * 60_000, absolute.getTime()),
    );
    await sessions.create({
      tokenHash: sha256(raw),
      userId: input.userId,
      organizationId: input.organizationId,
      mfaVerified: input.mfaVerified,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 300),
      lastSeenAt: now,
      idleExpiresAt: idle,
      absoluteExpiresAt: absolute,
    });
    return { raw, csrf: this.csrfFor(raw), maxAgeMs: absolute.getTime() - now.getTime() };
  }

  async validate(raw: string): Promise<AuthContext | null> {
    const tokenHash = sha256(raw);
    const s = await sessions.findByTokenHash(tokenHash);
    if (!s || s.principal === 'client') return null; // portal sessions never authenticate staff routes
    const now = new Date();
    if (s.idleExpiresAt < now || s.absoluteExpiresAt < now) {
      await sessions.deleteByTokenHash(tokenHash);
      return null;
    }
    const [user, membership] = await Promise.all([
      users.findById(s.userId),
      memberships.find(s.organizationId, s.userId),
    ]);
    if (!user || user.status !== 'active' || !membership || membership.status !== 'active') {
      await sessions.deleteByTokenHash(tokenHash);
      return null;
    }
    // Sliding idle window, written at most once a minute.
    if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
      const idle = new Date(
        Math.min(
          now.getTime() + this.env.SESSION_IDLE_MINUTES * 60_000,
          s.absoluteExpiresAt.getTime(),
        ),
      );
      await sessions.touch(s._id, now, idle);
    }
    return {
      userId: String(user._id),
      organizationId: String(s.organizationId),
      role: membership.role,
      sessionTokenHash: tokenHash,
      csrfToken: this.csrfFor(raw),
      mfaEnabled: user.mfa.enabled,
      mfaEnrollmentRequired: roleRequiresMfa(membership.role) && !user.mfa.enabled,
    };
  }

  /** The user's active sessions, without any token material. */
  async listFor(userId: string, currentTokenHash: string) {
    const rows = await sessions.listForUser(userId);
    return {
      data: rows.map((s) => ({
        id: String(s._id),
        current: s.tokenHash === currentTokenHash,
        ip: s.ip ?? null,
        userAgent: s.userAgent ?? null,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.absoluteExpiresAt,
      })),
    };
  }

  async revokeOne(
    userId: string,
    id: string,
    currentTokenHash: string,
  ): Promise<'ok' | 'current' | 'missing'> {
    const rows = await sessions.listForUser(userId);
    const target = rows.find((s) => String(s._id) === id);
    if (!target) return 'missing';
    if (target.tokenHash === currentTokenHash) return 'current';
    await sessions.deleteOneForUser(userId, id);
    return 'ok';
  }

  revoke(tokenHash: string) {
    return sessions.deleteByTokenHash(tokenHash);
  }
  revokeAllForUser(userId: string) {
    return sessions.deleteAllForUser(userId);
  }
  revokeOthers(userId: string, keepTokenHash: string) {
    return sessions.deleteOthersForUser(userId, keepTokenHash);
  }
}
