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
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380',
    QUEUE_PREFIX: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    JOB_BACKOFF_MS: '40',
    AUTH_RATE_LIMIT_PER_MIN: '1000',
    GLOBAL_RATE_LIMIT_PER_MIN: '100000',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

/** Boots the app against the dev replica set and starts from an empty database. */
export async function bootApp(overrides: Record<string, string> = {}): Promise<INestApplication> {
  const env = testEnv(overrides);
  const app = await createApp(env);
  envs.set(app, env);
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

// ---- Background processing: workers, fake Grok, queue settling ----
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import {
  GrokClient,
  startWorkers,
  silentLogger,
  type JobQueues,
  type WorkerHandle,
} from '@assar/jobs';
import { ClamAvScanProvider, DisabledScanProvider } from '@assar/storage';
import { createStorage } from '../src/storage/storage.module';
import { QUEUES } from '../src/queue/queue.module';

/** Waits until the scan (and optionally AI) queues have nothing waiting, running or delayed. */
export async function settle(app: INestApplication, o: { ai?: boolean } = {}, timeoutMs = 20_000) {
  const queues = app.get<JobQueues>(QUEUES, { strict: false });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await queues.counts();
    const busy = (q: Record<string, number>) =>
      (q.waiting ?? 0) + (q.active ?? 0) + (q.delayed ?? 0);
    if (busy(c.scan) === 0 && (!o.ai || busy(c.ai) === 0)) return;
    if (Date.now() > deadline) throw new Error(`queues did not settle: ${JSON.stringify(c)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export interface FakeGrokRequest {
  auth: string | undefined;
  body: { model: string; messages: { role: string; content: string }[] };
}
type GrokStep =
  | { status: number }
  | { json: object }
  | { rawContent: string }
  | { delayMs: number; then?: GrokStep };

/**
 * A stand-in for the Grok chat-completions API. By default it answers like a well-behaved model:
 * for every source it returns one item that quotes the source's first line verbatim.
 * Queue `steps` to simulate outages, bad output or fabricated quotes.
 */
export async function startFakeGrok() {
  const requests: FakeGrokRequest[] = [];
  const steps: GrokStep[] = [];

  const wellBehaved = (user: string) => {
    const items = [...user.matchAll(/<source id="(S\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map(
      ([, id, text]) => ({
        label: 'Key point',
        text: `Point drawn from ${id}`,
        dateText: null,
        risk: null,
        citations: [{ sourceId: id, quote: text!.split('\n')[0]!.slice(0, 80) }],
      }),
    );
    return {
      title: 'Test output',
      body: `Summary of ${items.length} source(s).`,
      answerable: true,
      items,
      assumptions: [],
    };
  };
  const completion = (content: string) => ({
    model: 'fake-grok-1',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });

  const server: HttpServer = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = JSON.parse(raw || '{}') as FakeGrokRequest['body'];
      requests.push({ auth: req.headers.authorization, body });
      let step: GrokStep | undefined = steps.shift();
      while (step && 'delayMs' in step) {
        const { delayMs, then } = step;
        await new Promise((r) => setTimeout(r, delayMs));
        step = then;
      }
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (step && 'status' in step) return send(step.status, { error: 'simulated' });
      if (step && 'rawContent' in step) return send(200, completion(step.rawContent));
      const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
      send(200, completion(JSON.stringify(step && 'json' in step ? step.json : wellBehaved(user))));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    /** Next requests consume these steps in order, then fall back to the well-behaved default. */
    script: (...s: GrokStep[]) => void steps.push(...s),
    reset: () => {
      steps.length = 0;
      requests.length = 0;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export interface TestWorkers {
  handle: WorkerHandle;
  close(): Promise<void>;
}

/** Runs the real worker code in-process against the same Redis/Mongo/storage as the app under test. */
export function startTestWorkers(
  env: Env,
  o: {
    clamdPort?: number;
    grokUrl?: string | null;
    maxContextChars?: number;
    allowUnscanned?: boolean;
  } = {},
): TestWorkers {
  const handle = startWorkers({
    redisUrl: env.REDIS_URL,
    prefix: env.QUEUE_PREFIX,
    logger: silentLogger,
    storage: createStorage(env),
    scanProvider: o.clamdPort
      ? new ClamAvScanProvider('127.0.0.1', o.clamdPort, 3000)
      : new DisabledScanProvider(),
    grok: o.grokUrl
      ? new GrokClient({
          apiKey: 'test-grok-key',
          baseUrl: o.grokUrl,
          model: 'test-model',
          timeoutMs: 1500,
        })
      : null,
    maxContextChars: o.maxContextChars,
    allowUnscanned: o.allowUnscanned,
    scanConcurrency: 2,
    aiConcurrency: 2,
  });
  return { handle, close: () => handle.close() };
}

/** Environment the app was booted with (workers must use the same queue prefix and storage). */
const envs = new WeakMap<INestApplication, Env>();
export const envOf = (app: INestApplication) => envs.get(app)!;
