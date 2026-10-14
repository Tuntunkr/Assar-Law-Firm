import type { INestApplication } from '@nestjs/common';
import { UserModel } from '@assar/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, bootApp, login, register, registerWithMfa, totp, uniqueEmail } from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    await request(app.getHttpServer()).get('/healthz').expect(200);
    const ready = await request(app.getHttpServer()).get('/readyz').expect(200);
    expect(ready.body.checks.mongodb).toBe('ok');
  });
});

describe('registration and sessions', () => {
  it('sets an httpOnly session cookie and never returns the password hash', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .post('/v1/auth/register')
      .send({
        organizationName: 'Cookie LLP',
        name: 'Co Owner',
        email: uniqueEmail(),
        password: PASSWORD,
      })
      .expect(201);
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies).toMatch(/assar_sid=[^;]+;.*HttpOnly/i);
    expect(cookies).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$argon2/);
    expect(res.body.role).toBe('owner');
  });

  it('stores Argon2id hashes, not passwords', async () => {
    const s = await register(app);
    const user = await UserModel.findOne({ email: s.email });
    expect(user?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects weak passwords and duplicate emails with the error envelope', async () => {
    const weak = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        organizationName: 'Weak LLP',
        name: 'Weak Owner',
        email: uniqueEmail(),
        password: 'short',
      })
      .expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
    expect(weak.body.error.requestId).toBeTruthy();
    expect(weak.body.error.details[0].path).toBe('password');

    const s = await register(app);
    await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ organizationName: 'Dup LLP', name: 'Dup Owner', email: s.email, password: PASSWORD })
      .expect(409);
  });

  it('requires authentication and rejects tampered cookies', async () => {
    await request(app.getHttpServer()).get('/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Cookie', 'assar_sid=forged')
      .expect(401);
  });

  it('enforces CSRF tokens and trusted origins on state-changing requests', async () => {
    const s = await register(app);
    await s.agent.post('/v1/auth/mfa/setup').expect(403); // no CSRF header
    await s.agent.post('/v1/auth/mfa/setup').set('x-csrf-token', 'wrong').expect(403);
    await s.agent
      .post('/v1/auth/mfa/setup')
      .set('x-csrf-token', s.csrf)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await s.agent
      .post('/v1/auth/mfa/setup')
      .set('x-csrf-token', s.csrf)
      .set('Origin', 'http://localhost:3001')
      .expect(201);
  });

  it('logout invalidates the session server-side', async () => {
    const s = await register(app);
    // Keep a copy of the session cookie to prove it is dead server-side, not just cleared in the browser.
    const cookie = (await login(app, s.email)).agent;
    await cookie.get('/v1/auth/me').expect(200);
    const rawCookie = s.agent.jar.getCookie('assar_sid', {
      path: '/',
      domain: '127.0.0.1',
      script: false,
      secure: false,
    });
    expect(rawCookie).toBeTruthy();
    await s.agent.post('/v1/auth/logout').set('x-csrf-token', s.csrf).expect(204);
    await s.agent.get('/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Cookie', `assar_sid=${rawCookie?.value}`)
      .expect(401);
  });
});

describe('login, lockout', () => {
  it('logs in with valid credentials and rejects invalid ones generically', async () => {
    const s = await register(app);
    const ok = await login(app, s.email);
    expect(ok.res.status).toBe(200);
    const bad = await login(app, s.email, 'wrong-password-123');
    const unknown = await login(app, uniqueEmail('ghost'));
    expect(bad.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(bad.res.body.error.message).toBe(unknown.res.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const s = await register(app);
    for (let i = 0; i < 5; i++)
      expect((await login(app, s.email, 'nope-nope-nope-1')).res.status).toBe(401);
    const locked = await login(app, s.email);
    expect(locked.res.status).toBe(429);
    expect(locked.res.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('MFA', () => {
  it('blocks privileged routes until the owner enrolls in MFA', async () => {
    const s = await register(app);
    expect(s.body.mfa).toEqual({ enabled: false, enrollmentRequired: true });
    const blocked = await s.agent.get('/v1/organization').expect(403);
    expect(blocked.body.error.code).toBe('MFA_ENROLLMENT_REQUIRED');
    await s.agent.get('/v1/auth/me').expect(200);
  });

  it('requires a valid code to log in once enabled, and rejects replay', async () => {
    const s = await registerWithMfa(app);
    await s.agent.get('/v1/organization').expect(200);

    const noCode = await login(app, s.email);
    expect(noCode.res.status).toBe(401);
    expect(noCode.res.body.error.code).toBe('MFA_REQUIRED');

    expect((await login(app, s.email, PASSWORD, '000000')).res.status).toBe(401);

    const next = totp.generate(s.secret, Date.now() + 30_000);
    expect((await login(app, s.email, PASSWORD, next)).res.status).toBe(200);
    expect((await login(app, s.email, PASSWORD, next)).res.status).toBe(401); // replay
  });

  it('stores the TOTP secret encrypted', async () => {
    const s = await registerWithMfa(app);
    const user = await UserModel.findOne({ email: s.email });
    expect(user?.mfa.secretEnc?.startsWith('v1.')).toBe(true);
    expect(user?.mfa.secretEnc).not.toContain(s.secret);
  });

  it('accepts each recovery code exactly once', async () => {
    const s = await registerWithMfa(app);
    const code = s.recoveryCodes[0]!;
    expect((await login(app, s.email, PASSWORD, code)).res.status).toBe(200);
    expect((await login(app, s.email, PASSWORD, code)).res.status).toBe(401);
  });

  it('does not allow privileged roles to disable MFA', async () => {
    const s = await registerWithMfa(app);
    const code = totp.generate(s.secret, Date.now() + 30_000);
    await s.agent
      .post('/v1/auth/mfa/disable')
      .set('x-csrf-token', s.csrf)
      .send({ password: PASSWORD, code })
      .expect(403);
  });
});

describe('password change', () => {
  it('revokes other sessions', async () => {
    const s = await registerWithMfa(app);
    const code = totp.generate(s.secret, Date.now() + 30_000);
    const other = await login(app, s.email, PASSWORD, code);
    expect(other.res.status).toBe(200);
    await s.agent
      .post('/v1/auth/change-password')
      .set('x-csrf-token', s.csrf)
      .send({ currentPassword: PASSWORD, newPassword: 'another-long-passphrase-2' })
      .expect(204);
    await other.agent.get('/v1/auth/me').expect(401);
    await s.agent.get('/v1/auth/me').expect(200);
  });
});
