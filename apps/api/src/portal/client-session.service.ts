import { Inject, Injectable } from '@nestjs/common';
import { clientUsers, clients, sessions } from '@assar/database';
import type { ClientContext } from '../common/auth-context';
import { hmac, randomToken, sha256 } from '../common/crypto';
import { ENV, type Env } from '../config/env';

/** Different cookie names from staff, so one browser can hold both and neither can stand in for the other. */
export const PORTAL_SESSION_COOKIE = 'assar_portal_sid';
export const PORTAL_CSRF_COOKIE = 'assar_portal_csrf';

@Injectable()
export class ClientSessionService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  csrfFor(raw: string): string {
    return hmac(this.env.SESSION_SECRET, `portal:${raw}`);
  }

  async create(input: {
    clientUserId: string;
    organizationId: string;
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
      userId: input.clientUserId,
      organizationId: input.organizationId,
      principal: 'client',
      mfaVerified: false,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 300),
      lastSeenAt: now,
      idleExpiresAt: idle,
      absoluteExpiresAt: absolute,
    });
    return { raw, csrf: this.csrfFor(raw), maxAgeMs: absolute.getTime() - now.getTime() };
  }

  async validate(raw: string): Promise<ClientContext | null> {
    const tokenHash = sha256(raw);
    const s = await sessions.findByTokenHash(tokenHash);
    if (!s || s.principal !== 'client') return null; // a staff session is never a portal session
    const now = new Date();
    if (s.idleExpiresAt < now || s.absoluteExpiresAt < now) {
      await sessions.deleteByTokenHash(tokenHash);
      return null;
    }
    const user = await clientUsers.findById(s.organizationId, s.userId);
    const client = user ? await clients.findById(s.organizationId, user.clientId) : null;
    if (!user || user.status !== 'active' || !client || client.status !== 'active') {
      await sessions.deleteByTokenHash(tokenHash);
      return null;
    }
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
      clientUserId: String(user._id),
      organizationId: String(s.organizationId),
      clientId: String(user.clientId),
      sessionTokenHash: tokenHash,
      csrfToken: this.csrfFor(raw),
    };
  }

  revoke(tokenHash: string) {
    return sessions.deleteByTokenHash(tokenHash);
  }
  revokeAllForUser(clientUserId: string) {
    return sessions.deleteAllForUser(clientUserId);
  }
  revokeOthers(clientUserId: string, keep: string) {
    return sessions.deleteOthersForUser(clientUserId, keep);
  }
}
