import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Types } from 'mongoose';
import {
  AiJobModel,
  AiOutputModel,
  DocumentModel,
  DocumentVersionModel,
  MatterAccessModel,
  MatterModel,
  MembershipModel,
  connectDatabase,
  disconnectDatabase,
  mongoose,
} from '@assar/database';
import { JobQueues, createRedis, readHeartbeats } from '@assar/jobs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorkerApp, type RunningWorker } from '../src/app.js';
import { loadWorkerEnv } from '../src/env.js';

const MONGO = (
  process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27117/assar_test?replicaSet=rs0'
).replace('/assar_test', '/assar_worker_test');
const REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380';
const PREFIX = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const dir = mkdtempSync(join(tmpdir(), 'assar-worker-'));
const TEXT = 'The supplier shall deliver the goods within thirty days of the order.';

let grokServer: Server;
let grokUrl = '';
let grokDelayMs = 0;
let grokHits = 0;

beforeAll(async () => {
  await connectDatabase(MONGO);
  await mongoose.connection.dropDatabase();
  grokServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      grokHits++;
      await new Promise((r) => setTimeout(r, grokDelayMs));
      const user = (JSON.parse(raw).messages as { role: string; content: string }[]).find(
        (m) => m.role === 'user',
      )!.content;
      const m = /<source id="(S\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/.exec(user)!;
      const content = JSON.stringify({
        title: 'T',
        body: 'Done',
        answerable: true,
        assumptions: [],
        items: [
          {
            label: 'Key point',
            text: 'x',
            citations: [{ sourceId: m[1], quote: m[2]!.slice(0, 40) }],
          },
        ],
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'fake-1',
          choices: [{ message: { content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
    });
  });
  await new Promise<void>((r) => grokServer.listen(0, '127.0.0.1', r));
  grokUrl = `http://127.0.0.1:${(grokServer.address() as { port: number }).port}/v1`;
});
afterAll(async () => {
  await new Promise<void>((r) => grokServer.close(() => r()));
  await connectDatabase(MONGO);
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
  rmSync(dir, { recursive: true, force: true });
});

const envFor = (extra: Record<string, string> = {}) =>
  loadWorkerEnv({
    NODE_ENV: 'test',
    MONGODB_URI: MONGO,
    REDIS_URL: REDIS,
    QUEUE_PREFIX: PREFIX,
    LOG_LEVEL: 'silent',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: dir,
    SESSION_SECRET: 's'.repeat(32),
    SCAN_PROVIDER: 'disabled',
    WORKER_HEALTH_PORT: '0',
    ...extra,
  });
interface StatusBody {
  status?: string;
  workerId?: string;
  aiEnabled?: boolean;
  paused?: boolean;
  checks?: Record<string, string>;
  scan: { completed: number; failed: number };
  queues: Record<string, Record<string, number>>;
  [k: string]: unknown;
}
const get = async (w: RunningWorker, path: string, method = 'GET') => {
  const res = await fetch(`http://127.0.0.1:${w.healthPort}${path}`, { method });
  return { status: res.status, body: (await res.json()) as StatusBody };
};

/** Creates a matter with one stored, scanned document directly in the database. */
async function seedMatter(content = TEXT) {
  const org = new Types.ObjectId();
  const user = new Types.ObjectId();
  await MembershipModel.create({ organizationId: org, userId: user, role: 'attorney' });
  const matter = await MatterModel.create({
    organizationId: org,
    clientId: new Types.ObjectId(),
    matterNumber: `M-${Date.now()}`,
    title: 'M',
    titleLower: 'm',
    practiceArea: 'tax',
    openedAt: new Date(),
    createdBy: user,
  });
  const doc = await DocumentModel.create({
    organizationId: org,
    matterId: matter._id,
    title: 'Supply',
    createdBy: user,
    latestVersion: 1,
  });
  const key = `org/${org}/matter/${matter._id}/doc/${doc._id}/v1-test`;
  mkdirSync(dirname(join(dir, key)), { recursive: true });
  writeFileSync(join(dir, key), content);
  const version = await DocumentVersionModel.create({
    organizationId: org,
    documentId: doc._id,
    matterId: matter._id,
    version: 1,
    filename: 'supply.txt',
    contentType: 'text/plain',
    sizeBytes: Buffer.byteLength(content),
    storageKey: key,
    status: 'scanning',
    uploadedBy: user,
  });
  return { org, user, matter, doc, version };
}

describe('worker app', () => {
  it('serves health endpoints and publishes a heartbeat that disappears on shutdown', async () => {
    const w = await startWorkerApp(envFor({ WORKER_ID: 'worker-a' }));
    const redis = createRedis(REDIS);
    try {
      expect(await get(w, '/healthz')).toMatchObject({
        status: 200,
        body: { status: 'ok', workerId: 'worker-a' },
      });
      expect(await get(w, '/readyz')).toEqual({
        status: 200,
        body: { status: 'ready', checks: { mongodb: 'ok', redis: 'ok' } },
      });
      const status = await get(w, '/status');
      expect(status.body).toMatchObject({
        aiEnabled: false,
        paused: false,
        scan: { completed: 0, failed: 0 },
      });
      expect(status.body.queues.scan).toHaveProperty('waiting');
      expect((await get(w, '/nope')).status).toBe(404);
      expect((await get(w, '/healthz', 'POST')).status).toBe(405);

      const beats = await readHeartbeats(redis, PREFIX);
      expect(beats).toHaveLength(1);
      expect(beats[0]).toMatchObject({ workerId: 'worker-a', aiEnabled: false });
      expect(await redis.ttl(`${PREFIX}:assar:heartbeat:worker-a`)).toBeGreaterThan(0); // expires by itself if the worker dies
    } finally {
      await w.shutdown();
    }
    expect(await readHeartbeats(redis, PREFIX)).toEqual([]);
    await expect(fetch(`http://127.0.0.1:${w.healthPort}/healthz`)).rejects.toThrow();
    redis.disconnect();
  });

  it('processes scan jobs from the queue with the configured scanner', async () => {
    const w = await startWorkerApp(envFor());
    const queues = new JobQueues({ redisUrl: REDIS, prefix: PREFIX, backoffDelayMs: 20 });
    try {
      const s = await seedMatter();
      await queues.enqueueScan(
        { organizationId: String(s.org), versionId: String(s.version._id) },
        'r1',
      );
      const done = await waitFor(
        () => DocumentVersionModel.findById(s.version._id).lean(),
        (v) => v!.status !== 'scanning',
      );
      // The scanner is "disabled" here, so the honest result is "skipped", never "clean".
      expect(done!.status).toBe('skipped');
      expect(done!.scan).toMatchObject({ engine: 'disabled', result: 'skipped' });
      // The counter updates just after the processor returns.
      await waitFor(
        () => get(w, '/status'),
        (r) => r.body.scan.completed >= 1,
      );
    } finally {
      await queues.close();
      await w.shutdown();
    }
  });

  it('runs AI jobs only when Grok is configured, and keeps the key out of status output', async () => {
    const withoutAi = await startWorkerApp(envFor());
    expect((await get(withoutAi, '/status')).body.aiEnabled).toBe(false);
    await withoutAi.shutdown();

    const w = await startWorkerApp(
      envFor({
        GROK_API_KEY: 'worker-secret-key',
        GROK_MODEL: 'test-model',
        GROK_API_BASE_URL: grokUrl,
      }),
    );
    const queues = new JobQueues({ redisUrl: REDIS, prefix: PREFIX, backoffDelayMs: 20 });
    try {
      const s = await seedMatter();
      await DocumentVersionModel.updateOne({ _id: s.version._id }, { status: 'clean' });
      const job = await AiJobModel.create({
        organizationId: s.org,
        matterId: s.matter._id,
        requestedBy: s.user,
        task: 'summary',
        documents: [{ documentId: s.doc._id, version: 1 }],
        maxAttempts: 2,
      });
      await queues.enqueueAi({ organizationId: String(s.org), aiJobId: String(job._id) }, 1, 2);

      const done = await waitFor(
        () => AiJobModel.findById(job._id).lean(),
        (j) => ['succeeded', 'failed'].includes(j!.status),
      );
      expect(done).toMatchObject({ status: 'succeeded', attempts: 1, model: 'fake-1' });
      const out = await AiOutputModel.findById(done!.outputId).lean();
      expect(out).toMatchObject({ reviewStatus: 'draft', reviewedBy: null }); // a worker can never approve
      expect((out!.result as { items: { verified: boolean }[] }).items[0]!.verified).toBe(true);
      const status = await get(w, '/status');
      expect(status.body.aiEnabled).toBe(true);
      expect(JSON.stringify(status.body)).not.toContain('worker-secret-key');
    } finally {
      await queues.close();
      await w.shutdown();
    }
  });

  it('finishes in-flight jobs before shutting down (no abandoned work)', async () => {
    grokDelayMs = 600;
    const w = await startWorkerApp(
      envFor({ GROK_API_KEY: 'k', GROK_MODEL: 'test-model', GROK_API_BASE_URL: grokUrl }),
    );
    const queues = new JobQueues({ redisUrl: REDIS, prefix: PREFIX, backoffDelayMs: 20 });
    try {
      const s = await seedMatter();
      await DocumentVersionModel.updateOne({ _id: s.version._id }, { status: 'clean' });
      const job = await AiJobModel.create({
        organizationId: s.org,
        matterId: s.matter._id,
        requestedBy: s.user,
        task: 'summary',
        documents: [{ documentId: s.doc._id, version: 1 }],
      });
      const hitsAtStart = grokHits;
      await queues.enqueueAi({ organizationId: String(s.org), aiJobId: String(job._id) }, 1, 3);
      await waitFor(
        () => AiJobModel.findById(job._id).lean(),
        (j) => j!.status === 'processing',
      );

      await w.shutdown(); // requested while the model call is still running
      await connectDatabase(MONGO); // shutdown closes the worker's own connection
      const after = await AiJobModel.findById(job._id).lean();
      expect(after).toMatchObject({ status: 'succeeded', attempts: 1 });
      expect(grokHits).toBe(hitsAtStart + 1); // exactly one model call: finished, not restarted or duplicated
    } finally {
      grokDelayMs = 0;
      await queues.close();
    }
  });

  it('re-checks matter access at run time (restricted matter, access removed)', async () => {
    const w = await startWorkerApp(
      envFor({ GROK_API_KEY: 'k', GROK_MODEL: 'test-model', GROK_API_BASE_URL: grokUrl }),
    );
    const queues = new JobQueues({ redisUrl: REDIS, prefix: PREFIX, backoffDelayMs: 20 });
    try {
      const s = await seedMatter();
      await DocumentVersionModel.updateOne({ _id: s.version._id }, { status: 'clean' });
      await MatterModel.updateOne({ _id: s.matter._id }, { restricted: true }); // requester is not on the access list
      expect(await MatterAccessModel.countDocuments({ matterId: s.matter._id })).toBe(0);
      const job = await AiJobModel.create({
        organizationId: s.org,
        matterId: s.matter._id,
        requestedBy: s.user,
        task: 'summary',
        documents: [{ documentId: s.doc._id, version: 1 }],
      });
      const hits = grokHits;
      await queues.enqueueAi({ organizationId: String(s.org), aiJobId: String(job._id) }, 1, 3);
      const done = await waitFor(
        () => AiJobModel.findById(job._id).lean(),
        (j) => ['succeeded', 'failed'].includes(j!.status),
      );
      expect(done).toMatchObject({
        status: 'failed',
        attempts: 1,
        error: { code: 'ACCESS_REVOKED', retryable: false },
      });
      expect(grokHits).toBe(hits);
    } finally {
      await queues.close();
      await w.shutdown();
    }
  });
});

async function waitFor<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out; last: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
