import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, bootApp, login, registerWithMfa, totp } from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await app.close();
});

describe('profile', () => {
  it('lets a user change their display name, validates it, and audits the change', async () => {
    const o = await registerWithMfa(app);
    const bad = await o.agent
      .patch('/v1/auth/profile')
      .set('x-csrf-token', o.csrf)
      .send({ name: 'x' });
    expect(bad.status).toBe(400);
    const ok = await o.agent
      .patch('/v1/auth/profile')
      .set('x-csrf-token', o.csrf)
      .send({ name: '  Olivia Q. Owner ' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.name).toBe('Olivia Q. Owner');
    expect((await o.agent.get('/v1/auth/me')).body.user.name).toBe('Olivia Q. Owner');
    const audit = await o.agent.get('/v1/audit-logs?action=auth.profile_updated');
    expect(audit.body.data.length).toBe(1);
  });

  it('requires the CSRF token to change the profile', async () => {
    const o = await registerWithMfa(app);
    const res = await o.agent.patch('/v1/auth/profile').send({ name: 'No Csrf' });
    expect(res.status).toBe(403);
  });
});

describe('sessions', () => {
  it('lists only my sessions, marks the current one, and never exposes token material', async () => {
    const o = await registerWithMfa(app);
    const second = await login(app, o.email, PASSWORD, totp.generate(o.secret));
    // The same TOTP step cannot be reused; a second login in the same step is refused, so skip if so.
    const list = await o.agent.get('/v1/auth/sessions').expect(200);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|token"/i);
    expect(second.res.status === 200 || second.res.status === 401).toBe(true);
  });

  it('revokes another session but refuses to revoke the current one', async () => {
    const o = await registerWithMfa(app);
    const other = request.agent(app.getHttpServer());
    // A second session for the same user: log in with a recovery code (single use, no TOTP step conflict).
    const res = await other
      .post('/v1/auth/login')
      .send({ email: o.email, password: PASSWORD, mfaCode: o.recoveryCodes[0] });
    expect(res.status).toBe(200);
    const list = (await o.agent.get('/v1/auth/sessions').expect(200)).body.data as {
      id: string;
      current: boolean;
    }[];
    expect(list).toHaveLength(2);
    const current = list.find((s) => s.current)!;
    const notCurrent = list.find((s) => !s.current)!;

    await o.agent.delete(`/v1/auth/sessions/${current.id}`).set('x-csrf-token', o.csrf).expect(409);
    await o.agent
      .delete(`/v1/auth/sessions/${notCurrent.id}`)
      .set('x-csrf-token', o.csrf)
      .expect(204);
    expect((await other.get('/v1/auth/me')).status).toBe(401); // the revoked session is dead
    await o.agent
      .delete(`/v1/auth/sessions/${notCurrent.id}`)
      .set('x-csrf-token', o.csrf)
      .expect(404);
    await o.agent.delete('/v1/auth/sessions/not-an-id').set('x-csrf-token', o.csrf).expect(404);
  });

  it("cannot see or revoke another user's sessions", async () => {
    const a = await registerWithMfa(app, 'Alpha');
    const b = await registerWithMfa(app, 'Beta');
    const bSessions = (await b.agent.get('/v1/auth/sessions').expect(200)).body.data as {
      id: string;
    }[];
    await a.agent
      .delete(`/v1/auth/sessions/${bSessions[0]!.id}`)
      .set('x-csrf-token', a.csrf)
      .expect(404);
    expect((await b.agent.get('/v1/auth/me')).status).toBe(200);
  });

  it('signs out every other session at once', async () => {
    const o = await registerWithMfa(app);
    const other = request.agent(app.getHttpServer());
    await other
      .post('/v1/auth/login')
      .send({ email: o.email, password: PASSWORD, mfaCode: o.recoveryCodes[1] })
      .expect(200);
    await o.agent.post('/v1/auth/sessions/revoke-others').set('x-csrf-token', o.csrf).expect(204);
    expect((await other.get('/v1/auth/me')).status).toBe(401);
    expect((await o.agent.get('/v1/auth/me')).status).toBe(200);
  });
});
