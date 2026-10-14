import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { mongoose, syncIndexes } from '@assar/database';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { loadEnv, type Env } from '../src/config/env';
import { TotpService } from '../src/auth/totp.service';

export const PASSWORD = 'correct-horse-battery-1';
export const totp = new TotpService();

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI:
      process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27117/assar_test?replicaSet=rs0',
    SESSION_SECRET: 'test-session-secret-test-session-secret',
    MFA_ENCRYPTION_KEY: 'test-mfa-encryption-key-test-mfa-key',
    CORS_ORIGINS: 'http://localhost:3001',
    REGISTRATION_ENABLED: 'true',
    AUTH_RATE_LIMIT_PER_MIN: '1000',
    GLOBAL_RATE_LIMIT_PER_MIN: '100000',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

/** Boots the app against the dev replica set and starts from an empty database. */
export async function bootApp(overrides: Record<string, string> = {}): Promise<INestApplication> {
  const app = await createApp(testEnv(overrides));
  await app.init();
  await mongoose.connection.dropDatabase();
  await syncIndexes();
  return app;
}

let counter = 0;
export const uniqueEmail = (p = 'user') => `${p}${Date.now()}${counter++}@example.test`;

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  email: string;
  body: {
    csrfToken: string;
    role: string;
    user: { id: string };
    organization: { id: string };
    mfa: { enabled: boolean; enrollmentRequired: boolean };
  };
}

export async function register(app: INestApplication, name = 'Firm') {
  const agent = request.agent(app.getHttpServer());
  const email = uniqueEmail('owner');
  const res = await agent
    .post('/v1/auth/register')
    .send({ organizationName: `${name} LLP`, name: 'Olivia Owner', email, password: PASSWORD });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.csrfToken as string, email, body: res.body } as Session;
}

/** Registers an owner and completes MFA enrollment so privileged routes are reachable. */
export async function registerWithMfa(app: INestApplication, name?: string) {
  const s = await register(app, name);
  const setup = await s.agent.post('/v1/auth/mfa/setup').set('x-csrf-token', s.csrf);
  const secret = setup.body.secret as string;
  const enable = await s.agent
    .post('/v1/auth/mfa/enable')
    .set('x-csrf-token', s.csrf)
    .send({ code: totp.generate(secret) });
  if (enable.status !== 200) throw new Error(`mfa enable failed: ${enable.status}`);
  return { ...s, secret, recoveryCodes: enable.body.recoveryCodes as string[] };
}

export async function login(
  app: INestApplication,
  email: string,
  password = PASSWORD,
  mfaCode?: string,
) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post('/v1/auth/login')
    .send({ email, password, ...(mfaCode ? { mfaCode } : {}) });
  return { agent, res, csrf: res.body?.csrfToken as string };
}

export type Owner = Awaited<ReturnType<typeof registerWithMfa>>;
export interface Member {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  email: string;
  userId: string;
  role: string;
}

let keyCounter = 0;
export const idemKey = () => `test-key-${Date.now()}-${keyCounter++}-padding`;

/** Invites a user with `role`, accepts the invitation, logs in (and enrolls MFA for roles that require it). */
export async function addMember(
  app: INestApplication,
  owner: Owner,
  role: string,
): Promise<Member> {
  const email = uniqueEmail(role);
  const inv = await owner.agent
    .post('/v1/organization/invitations')
    .set('x-csrf-token', owner.csrf)
    .set('idempotency-key', idemKey())
    .send({ email, role });
  if (inv.status !== 201)
    throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  const accept = await request(app.getHttpServer())
    .post('/v1/auth/accept-invitation')
    .send({ token: inv.body.token, name: `Test ${role}`, password: PASSWORD });
  if (accept.status !== 201) throw new Error(`accept failed: ${accept.status}`);
  const { agent, res, csrf } = await login(app, email);
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  if (res.body.mfa.enrollmentRequired) {
    const setup = await agent.post('/v1/auth/mfa/setup').set('x-csrf-token', csrf);
    await agent
      .post('/v1/auth/mfa/enable')
      .set('x-csrf-token', csrf)
      .send({ code: totp.generate(setup.body.secret) })
      .expect(200);
  }
  return { agent, csrf, email, userId: res.body.user.id as string, role };
}

export const post = (m: { agent: Member['agent']; csrf: string }, url: string, body: object) =>
  m.agent.post(url).set('x-csrf-token', m.csrf).send(body);
export const patch = (m: { agent: Member['agent']; csrf: string }, url: string, body: object) =>
  m.agent.patch(url).set('x-csrf-token', m.csrf).send(body);
export const put = (m: { agent: Member['agent']; csrf: string }, url: string, body: object) =>
  m.agent.put(url).set('x-csrf-token', m.csrf).send(body);
export const del = (m: { agent: Member['agent']; csrf: string }, url: string) =>
  m.agent.delete(url).set('x-csrf-token', m.csrf);

export async function newClient(
  m: { agent: Member['agent']; csrf: string },
  name = 'Acme Holdings LLC',
) {
  const res = await post(m, '/v1/clients', { type: 'organization', name });
  if (res.status !== 201)
    throw new Error(`client failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export async function newMatter(
  m: { agent: Member['agent']; csrf: string },
  clientId: string,
  extra: object = {},
) {
  const res = await post(m, '/v1/matters', {
    clientId,
    title: 'Sample Matter',
    practiceArea: 'litigation',
    ...extra,
  });
  if (res.status !== 201)
    throw new Error(`matter failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; matterNumber: string };
}

// ---- Documents: fake clamd, local storage, upload helpers ----
import { createServer, type Server } from 'node:net';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScanService } from '../src/documents/scan.service';

export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** A minimal clamd that speaks the INSTREAM protocol, so the real ClamAV client code is exercised. */
export async function startFakeClamd() {
  let mode: 'ok' | 'down' = 'ok';
  const server: Server = createServer((sock) => {
    if (mode === 'down') return void sock.destroy();
    let buf = Buffer.alloc(0);
    let started = false;
    const parts: Buffer[] = [];
    sock.on('error', () => undefined);
    sock.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (!started) {
        const i = buf.indexOf(0);
        if (i < 0) return;
        if (buf.subarray(0, i).toString() !== 'zINSTREAM') return void sock.destroy();
        started = true;
        buf = buf.subarray(i + 1);
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const infected = Buffer.concat(parts)
            .toString('latin1')
            .includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
          sock.end(infected ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buf.length < 4 + len) break;
        parts.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    setMode: (m: 'ok' | 'down') => (mode = m),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export function tempStorageDir() {
  const dir = mkdtempSync(join(tmpdir(), 'assar-storage-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** All files currently stored under `dir` (relative paths). */
export function storedFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

export const settle = (app: INestApplication) => app.get(ScanService, { strict: false }).idle();

type Actor = { agent: Member['agent']; csrf: string };
export interface UploadSpec {
  title?: string;
  filename?: string;
  contentType?: string;
  content?: string | Buffer;
}

/** Full happy-path upload: request URL, PUT bytes, complete, wait for the scan to settle. */
export async function uploadDocument(
  app: INestApplication,
  who: Actor,
  matterId: string,
  spec: UploadSpec = {},
) {
  const content = Buffer.isBuffer(spec.content)
    ? spec.content
    : Buffer.from(spec.content ?? 'synthetic test document');
  const created = await post(who, `/v1/matters/${matterId}/documents`, {
    title: spec.title ?? 'Test Document',
    filename: spec.filename ?? 'test.txt',
    contentType: spec.contentType ?? 'text/plain',
    sizeBytes: content.length,
  });
  if (created.status !== 201)
    throw new Error(`create doc failed: ${created.status} ${JSON.stringify(created.body)}`);
  const docId = created.body.document.id as string;
  await putBytes(app, created.body.upload, content);
  const done = await post(who, `/v1/documents/${docId}/versions/1/complete`, {});
  if (done.status !== 200)
    throw new Error(`complete failed: ${done.status} ${JSON.stringify(done.body)}`);
  await settle(app);
  return { docId, created: created.body, content };
}

export function putBytes(
  app: INestApplication,
  upload: { url: string; headers: Record<string, string> },
  bytes: Buffer,
) {
  const u = new URL(upload.url);
  return request(app.getHttpServer())
    .put(u.pathname + u.search)
    .set(upload.headers)
    .send(bytes);
}
