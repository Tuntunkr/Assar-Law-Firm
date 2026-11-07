import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  addMember,
  bootApp,
  newClient,
  portalUser,
  post,
  registerWithMfa,
  uniqueEmail,
} from './helpers';

let app: INestApplication;
const logLines: string[] = [];
const sink = new Writable({
  write(chunk, _enc, cb) {
    logLines.push(String(chunk));
    cb();
  },
});

beforeAll(async () => {
  app = await bootApp(
    { LOG_LEVEL: 'info', MAX_JSON_BODY_BYTES: '65536', CORS_ORIGINS: 'http://localhost:3001' },
    { logDestination: sink },
  );
});
afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());

describe('response headers', () => {
  it.each([
    ['a successful response', () => http().get('/healthz')],
    ['an authentication error', () => http().get('/v1/auth/me')],
    ['an unknown route', () => http().get('/v1/nope')],
  ])('are locked down on %s', async (_name, call) => {
    const res = await call();
    const h = res.headers;
    expect(h['content-security-policy']).toBe(
      "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'",
    );
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['cross-origin-resource-policy']).toBe('same-site');
    expect(h['strict-transport-security']).toMatch(/max-age=\d{7,}; includeSubDomains/);
    expect(h['permissions-policy']).toMatch(/camera=\(\), microphone=\(\), geolocation=\(\)/);
    expect(h['cache-control']).toBe('no-store');
    expect(h['x-powered-by']).toBeUndefined();
    expect(h['etag']).toBeUndefined(); // private data is never revalidated from a cache
    expect(h['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never allows private API responses to be cached', async () => {
    const owner = await registerWithMfa(app);
    await newClient(owner, 'Cache Test Client');
    for (const url of ['/v1/auth/me', '/v1/clients', '/v1/organization/members']) {
      const res = await owner.agent.get(url).expect(200);
      expect(res.headers['cache-control'], url).toBe('no-store');
      expect(res.headers['etag'], url).toBeUndefined();
    }
  });
});

describe('CORS', () => {
  it('reflects only configured origins, with credentials, and nothing for others', async () => {
    const ok = await http().get('/healthz').set('Origin', 'http://localhost:3001');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['vary']).toMatch(/Origin/);
    for (const origin of ['https://evil.example', 'http://localhost:3001.evil.example', 'null']) {
      const bad = await http().get('/healthz').set('Origin', origin);
      expect(bad.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('answers preflights narrowly', async () => {
    const pre = await http()
      .options('/v1/clients')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-headers']).toBe(
      'content-type,x-csrf-token,idempotency-key,x-request-id',
    );
    expect(pre.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    const evil = await http()
      .options('/v1/clients')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses state-changing requests from untrusted origins even with a valid session', async () => {
    const owner = await registerWithMfa(app);
    const res = await owner.agent
      .post('/v1/clients')
      .set('x-csrf-token', owner.csrf)
      .set('Origin', 'https://evil.example')
      .send({ type: 'individual', name: 'Forged Client' });
    expect(res.status).toBe(403);
    expect((await owner.agent.get('/v1/clients').expect(200)).body.data).toEqual([]);
  });
});

describe('request bodies & input', () => {
  it('answers malformed JSON with a generic 400 that does not echo the input', async () => {
    const res = await http()
      .post('/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{"email": "victim@example.test", "password": ');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Malformed request',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/victim|Unexpected/);
  });

  it('rejects oversized bodies with 413 rather than a server error', async () => {
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: 'a@b.test', password: 'x'.repeat(70_000) });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
    });
    expect(res.body.error.requestId).toBeTruthy();
    const fine = await http()
      .post('/v1/auth/login')
      .send({ email: 'a@b.test', password: 'x'.repeat(100) });
    expect(fine.status).toBe(401); // normal requests are unaffected
  });

  it('rejects unsupported charsets and content types without crashing', async () => {
    const res = await http()
      .post('/v1/auth/login')
      .set('content-type', 'application/json; charset=utf-7')
      .send('{}');
    expect([400, 415]).toContain(res.status);
    expect(res.body.error.code).toMatch(/VALIDATION_FAILED/);
  });

  it('treats operator-looking query parameters as plain text, never as database operators', async () => {
    const owner = await registerWithMfa(app);
    for (const name of ['Alpha Client', 'Beta Client', 'Gamma Client'])
      await newClient(owner, name);
    const all = (await owner.agent.get('/v1/clients').expect(200)).body.data.length;
    expect(all).toBe(3);
    // None of these may change the result set (they are ignored or rejected, never interpreted).
    for (const q of [
      'q[$ne]=zzz',
      'q[$regex]=.*',
      'status[$ne]=archived',
      'limit[$gt]=0',
      '$where=1',
      'q[$gt]=',
      'cursor[$ne]=x',
    ]) {
      const res = await owner.agent.get(`/v1/clients?${q}`);
      if (res.status === 200) expect(res.body.data, q).toHaveLength(3);
      else expect(res.status, q).toBe(400);
    }
    expect((await owner.agent.get('/v1/clients?q=.*').expect(200)).body.data).toHaveLength(0); // regex characters are literal
  });

  it('cannot be logged into with operator objects instead of strings', async () => {
    const owner = await registerWithMfa(app);
    for (const body of [
      { email: { $ne: null }, password: { $ne: null } },
      { email: owner.email, password: { $ne: 'x' } },
      { email: owner.email, password: { $gt: '' } },
      { email: { $regex: '.*' }, password: PASSWORD },
      { email: [owner.email], password: PASSWORD },
      { $or: [{ email: owner.email }], password: PASSWORD },
    ]) {
      const res = await http().post('/v1/auth/login').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('keeps unexpected fields out of stored records (no mass assignment)', async () => {
    const owner = await registerWithMfa(app);
    const res = await post(owner, '/v1/clients', {
      type: 'individual',
      name: 'Mass Assignment',
      organizationId: 'a'.repeat(24),
      status: 'archived',
      createdBy: 'b'.repeat(24),
      _id: 'c'.repeat(24),
      normalizedName: 'hijacked',
      tokens: ['hijacked'],
    }).expect(201);
    expect(res.body.status).toBe('active');
    const got = (await owner.agent.get(`/v1/clients/${res.body.id}`).expect(200)).body;
    expect(got.id).not.toBe('c'.repeat(24));
    expect((await owner.agent.get('/v1/clients?q=hijacked').expect(200)).body.data).toHaveLength(0);
    expect((await owner.agent.get('/v1/clients?q=mass').expect(200)).body.data).toHaveLength(1);
  });
});

describe('logging', () => {
  it('never writes passwords, cookies, tokens or request bodies to the logs', async () => {
    logLines.length = 0;
    const owner = await registerWithMfa(app);
    const portal = await portalUser(
      app,
      await addMember(app, owner, 'attorney'),
      owner.body.organization.slug,
      await newClient(owner, 'Log Test Client'),
      uniqueEmail('logclient'),
    );
    const secrets = [PASSWORD, owner.csrf, portal.csrf, owner.email];

    await http()
      .post('/v1/auth/login')
      .send({ email: owner.email, password: 'Wrong-Password-Do-Not-Log-1' }); // secrets:ignore (fake test credential)
    await http()
      .post('/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{"password":"Malformed-Do-Not-Log-2"'); // secrets:ignore (fake test credential)
    await owner.agent
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer ast_should_never_be_logged_0123456789');
    await owner.agent.post('/v1/clients').set('x-csrf-token', owner.csrf).send({
      type: 'individual',
      name: 'Confidential Client Name',
      email: 'private.person@example.test',
    });
    await portal.agent.get('/v1/portal/matters');

    const logs = logLines.join('');
    expect(logs.length).toBeGreaterThan(0); // requests really were logged
    const parsed = logLines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed.some((l) => l.msg === 'request' && l.path === '/v1/auth/login')).toBe(true);
    for (const s of [
      ...secrets,
      'Wrong-Password-Do-Not-Log-1',
      'Malformed-Do-Not-Log-2',
      'ast_should_never_be_logged',
      'Confidential Client Name',
      'private.person@example.test',
      'assar_sid',
      'assar_portal_sid',
    ]) {
      expect(logs, `logs contain "${s}"`).not.toContain(s);
    }
    // Structured and useful: method, path, status and timing, correlated by request id.
    const req = parsed.find((l) => l.msg === 'request' && l.path === '/v1/clients')!;
    expect(req).toMatchObject({ method: 'POST', status: 201, requestId: expect.any(String) });
    expect(typeof req.ms).toBe('number');
  });
});
