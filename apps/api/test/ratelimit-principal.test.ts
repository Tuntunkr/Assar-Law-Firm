import type { INestApplication } from '@nestjs/common';
import { SERVICE_SCOPES } from '@assar/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  bootApp,
  createServiceToken,
  newClient,
  portalUser,
  post,
  registerWithMfa,
} from './helpers';

const PRINCIPAL = 30;
const SERVICE = 5;
let app: INestApplication;
beforeAll(async () => {
  app = await bootApp({
    PRINCIPAL_RATE_LIMIT_PER_MIN: String(PRINCIPAL),
    SERVICE_RATE_LIMIT_PER_MIN: String(SERVICE),
    AI_ENABLED: 'true',
  });
});
afterAll(async () => {
  await app.close();
});

type Agent = {
  agent: {
    get: (u: string) => Promise<{
      status: number;
      headers: Record<string, string>;
      body: { error: { code: string; message: string; requestId: string } };
    }>;
  };
};
/** Calls `/v1/auth/me` until it is refused; returns how many calls succeeded and the refusal. */
async function untilLimited(who: Agent, url = '/v1/auth/me', max = PRINCIPAL + 5) {
  let ok = 0;
  for (let i = 0; i < max; i++) {
    const res = await who.agent.get(url);
    if (res.status === 429) return { ok, res };
    expect(res.status).toBe(200);
    ok++;
  }
  throw new Error(`never limited after ${max} calls`);
}

describe('per-user limits', () => {
  it('stops one signed-in user at the limit with a clear 429, without affecting anyone else', async () => {
    const owner = await registerWithMfa(app);
    const noisy = await addMember(app, owner, 'attorney');
    const quiet = await addMember(app, owner, 'attorney');

    const { ok, res } = await untilLimited(noisy);
    expect(ok).toBe(PRINCIPAL);
    expect(res.body.error).toMatchObject({ code: 'RATE_LIMITED', message: 'Too many requests' });
    expect(res.body.error.requestId).toBeTruthy();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);

    // The same office, the same IP address: a colleague is untouched.
    expect((await quiet.agent.get('/v1/auth/me')).status).toBe(200);
    expect((await owner.agent.get('/v1/auth/me')).status).toBe(200);
    // And the limit keeps holding for the noisy user.
    expect((await noisy.agent.get('/v1/auth/me')).status).toBe(429);
  });

  it('counts forbidden requests too, so permission probing cannot run unthrottled', async () => {
    const owner = await registerWithMfa(app);
    const staff = await addMember(app, owner, 'staff');
    const { ok, res } = await (async () => {
      let n = 0;
      for (let i = 0; i < PRINCIPAL + 5; i++) {
        const r = await staff.agent.get('/v1/billing/settings');
        if (r.status === 429) return { ok: n, res: r };
        expect(r.status).toBe(403);
        n++;
      }
      throw new Error('never limited');
    })();
    expect(ok).toBe(PRINCIPAL);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('anonymous traffic', () => {
  it('never consumes anyone’s per-user budget (regression: all anonymous callers once shared one bucket)', async () => {
    const owner = await registerWithMfa(app);
    const noisy = await addMember(app, owner, 'attorney');
    const { default: request } = await import('supertest');
    // Far more anonymous requests than the per-user limit: they are public, so the per-user limiter must ignore them.
    for (let i = 0; i < PRINCIPAL * 2; i++) {
      expect(
        (
          await request(app.getHttpServer())
            .post('/v1/auth/login')
            .send({ email: 'nobody@example.test', password: 'wrong-password-1' })
        ).status,
      ).toBe(401);
      expect((await request(app.getHttpServer()).get('/healthz')).status).toBe(200);
    }
    expect((await noisy.agent.get('/v1/auth/me')).status).toBe(200);
    expect((await untilLimited(noisy)).ok).toBe(PRINCIPAL - 1); // exactly its own budget, minus the call above
  });
});

describe('per-portal-user limits', () => {
  it('limits a client independently of staff', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const client = await portalUser(app, attorney, owner.body.organization.slug, clientId);
    const { ok, res } = await untilLimited(client, '/v1/portal/me');
    expect(ok).toBe(PRINCIPAL);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect((await attorney.agent.get('/v1/auth/me')).status).toBe(200);
  });
});

describe('per-token limits for automation', () => {
  it('rate-limits each service token separately, and returns Retry-After', async () => {
    const owner = await registerWithMfa(app);
    const a = bearer(app, (await createServiceToken(owner, [...SERVICE_SCOPES])).token);
    const b = bearer(app, (await createServiceToken(owner, [...SERVICE_SCOPES])).token);
    for (let i = 0; i < SERVICE; i++)
      expect((await a.get('/v1/automation/reminders/due')).status).toBe(200);
    const limited = await a.get('/v1/automation/reminders/due');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await b.get('/v1/automation/reminders/due')).status).toBe(200); // a different token is unaffected
  });

  it('does not count requests that fail authentication against the token', async () => {
    const owner = await registerWithMfa(app);
    const good = await createServiceToken(owner, ['reminders:read']);
    const wrongScope = bearer(app, (await createServiceToken(owner, ['reports:read'])).token);
    for (let i = 0; i < SERVICE + 3; i++)
      expect((await wrongScope.get('/v1/automation/reminders/due')).status).toBe(401);
    expect((await bearer(app, good.token).get('/v1/automation/reminders/due')).status).toBe(200);
  });
});

describe('tighter limits on expensive routes', () => {
  it('caps AI job creation per user (each job costs money) while normal calls continue', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const body = {
      task: 'summary',
      matterId: 'a'.repeat(24),
      documents: [{ documentId: 'b'.repeat(24) }],
    };
    let accepted = 0;
    for (let i = 0; i < 21; i++) {
      const r = await post(attorney, '/v1/ai/jobs', body);
      if (r.status === 429) break;
      expect([404, 400, 503]).toContain(r.status); // reaches the handler; the matter does not exist
      accepted++;
    }
    expect(accepted).toBe(20);
    const refused = await post(attorney, '/v1/ai/jobs', body);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect((await attorney.agent.get('/v1/auth/me')).status).toBe(200); // the baseline budget still has room
  });

  it('caps confidential exports per user', async () => {
    const owner = await registerWithMfa(app);
    const billing = await addMember(app, owner, 'billing');
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      const r = await billing.agent.get(`/v1/reports/time/export?from=${day(-30)}&to=${day(1)}`);
      if (r.status === 429) break;
      expect(r.status).toBe(200);
      ok++;
    }
    expect(ok).toBe(10);
  });
});
