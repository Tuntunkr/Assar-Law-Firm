/**
 * End-to-end: REAL n8n running the committed workflows against the REAL API.
 * Skipped unless N8N_BIN points at an n8n executable (n8n 1.x). To run:
 *   N8N_BIN=/path/to/node_modules/.bin/n8n pnpm --filter @assar/api test -- n8n.e2e
 * Needs MongoDB + Redis like the other integration tests. Uses a throw-away n8n data folder.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { SERVICE_SCOPES } from '@assar/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bootApp,
  createServiceToken,
  envOf,
  newClient,
  newMatter,
  post,
  registerWithMfa,
  startFakeClamd,
  startFakeGrok,
  startTestWorkers,
  tempStorageDir,
  uploadDocument,
  waitUntil,
  type Member,
  type Owner,
  type TestWorkers,
} from './helpers';

const N8N_BIN = process.env.N8N_BIN;
const run = promisify(execFile);
const SECRET = 'n8n-e2e-shared-secret-0123456789abcdef'; // secrets:ignore (fake shared secret used only against a throw-away local n8n)
const WORKFLOWS_DIR = join(__dirname, '..', '..', '..', 'services', 'workflows', 'workflows');

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

describe.skipIf(!N8N_BIN)('n8n running the committed workflows', () => {
  let app: INestApplication;
  let clamd: Awaited<ReturnType<typeof startFakeClamd>>;
  let grok: Awaited<ReturnType<typeof startFakeGrok>>;
  let workers: TestWorkers;
  let n8n: ChildProcess;
  let n8nPort = 0;
  let home = '';
  let n8nEnv: NodeJS.ProcessEnv;
  const storage = tempStorageDir();
  let owner: Owner;
  let attorney: Member;
  let paralegal: Member;

  const cli = async (args: string[]) => {
    const { stdout, stderr } = await run(N8N_BIN!, args, {
      env: n8nEnv,
      timeout: 240_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return `${stdout}\n${stderr}`;
  };

  beforeAll(async () => {
    clamd = await startFakeClamd();
    grok = await startFakeGrok();
    app = await bootApp({
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: storage.dir,
      AI_ENABLED: 'true',
      WORKFLOWS_ENABLED: 'true',
    });
    await app.listen(0, '127.0.0.1');
    const apiPort = (app.getHttpServer().address() as { port: number }).port;
    n8nPort = await freePort();

    owner = await registerWithMfa(app);
    attorney = await addMember(app, owner, 'attorney');
    paralegal = await addMember(app, owner, 'paralegal');
    const { token } = await createServiceToken(owner, [...SERVICE_SCOPES]);

    // A throw-away n8n: the committed workflows with only the API URL filled in, plus the two credentials.
    home = mkdtempSync(join(tmpdir(), 'assar-n8n-'));
    // n8n gets a clean environment: NODE_ENV=test and the test runner's variables would change its behaviour.
    const base = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => k !== 'NODE_ENV' && !k.startsWith('VITEST') && !k.startsWith('VITE_'),
      ),
    );
    n8nEnv = {
      ...base,
      N8N_USER_FOLDER: home,
      N8N_PORT: String(n8nPort),
      N8N_HOST: '127.0.0.1',
      N8N_DIAGNOSTICS_ENABLED: 'false',
      N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
      N8N_PERSONALIZATION_ENABLED: 'false',
      N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false',
      N8N_EXPRESSION_ENGINE: 'legacy', // avoids the native isolated-vm module, which can't build on every machine
      N8N_RUNNERS_ENABLED: 'false',
      N8N_SKIP_WEBHOOK_DEREGISTRATION_SHUTDOWN: 'true',
      EXECUTIONS_DATA_SAVE_ON_SUCCESS: 'all',
    };
    const files = join(home, 'import');
    mkdirSync(files, { recursive: true });
    for (const f of readdirSync(WORKFLOWS_DIR)) {
      const wf = JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'));
      const cfg = wf.nodes.find((n: { name: string }) => n.name === 'Config');
      cfg.parameters.assignments.assignments[0].value = `http://127.0.0.1:${apiPort}/v1`;
      // Only the schedule interval differs from the committed file, so hourly/daily workflows run within seconds.
      const schedule = wf.nodes.find(
        (n: { type: string }) => n.type === 'n8n-nodes-base.scheduleTrigger',
      );
      if (schedule) schedule.parameters.rule.interval = [{ field: 'seconds', secondsInterval: 4 }];
      writeFileSync(join(files, f), JSON.stringify([wf]));
    }
    writeFileSync(
      join(files, 'credentials.json'),
      JSON.stringify([
        {
          id: 'assar-automation-token',
          name: 'Assar automation token',
          type: 'httpHeaderAuth',
          data: { name: 'Authorization', value: `Bearer ${token}` },
        },
        {
          id: 'assar-webhook-token',
          name: 'Assar webhook token',
          type: 'httpHeaderAuth',
          data: { name: 'X-Assar-Webhook-Token', value: SECRET },
        },
      ]),
    );
    await cli(['import:credentials', `--input=${join(files, 'credentials.json')}`]);
    for (const f of readdirSync(WORKFLOWS_DIR))
      await cli(['import:workflow', `--input=${join(files, f)}`]);
    const listing = await cli(['list:workflow']);
    expect(
      listing.split('\n').filter((l) => /\|Assar: /.test(l)),
      `n8n listed:\n${listing}`,
    ).toHaveLength(5);
    await cli(['update:workflow', '--all', '--active=true']);

    n8n = spawn(N8N_BIN!, ['start'], { env: n8nEnv, stdio: 'ignore' });
    await waitUntil(
      () =>
        fetch(`http://127.0.0.1:${n8nPort}/healthz`)
          .then((r) => r.ok)
          .catch(() => false),
      (ok) => ok,
      120_000,
    );

    // n8n reports healthy a few seconds before it has registered the webhooks (it answers 404 until then).
    await waitUntil(
      async () => {
        const codes = await Promise.all(
          ['matter-created', 'document-scan-clean', 'ai-output-ready'].map((p) =>
            fetch(`http://127.0.0.1:${n8nPort}/webhook/assar/${p}`, { method: 'POST' })
              .then((r) => r.status)
              .catch(() => 0),
          ),
        );
        return codes;
      },
      (codes) => codes.every((c) => c === 403),
      120_000,
    );

    // The worker delivers the platform's events to this n8n.
    workers = startTestWorkers(envOf(app), {
      clamdPort: clamd.port,
      grokUrl: grok.url,
      n8n: { baseUrl: `http://127.0.0.1:${n8nPort}/webhook/assar`, secret: SECRET },
    });
  }, 600_000);

  afterAll(async () => {
    await workers?.close();
    n8n?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1000));
    await app?.close();
    await grok?.close();
    await clamd?.close();
    storage.cleanup();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  const tasksFor = async (who: Member | Owner, matterId: string) =>
    (await who.agent.get(`/v1/tasks?matterId=${matterId}&limit=50`)).body.data as {
      title: string;
      assigneeId: string | null;
      createdVia: string;
    }[];

  it('rejects event deliveries that do not carry the shared secret', async () => {
    const url = `http://127.0.0.1:${n8nPort}/webhook/assar/matter-created`;
    const body = JSON.stringify({
      id: 'x',
      event: 'matter.created',
      organizationId: 'o',
      occurredAt: new Date().toISOString(),
      data: {},
    });
    const none = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const wrong = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-assar-webhook-token': 'wrong' },
      body,
    });
    expect([none.status, wrong.status]).toEqual([403, 403]);
  });

  it('creates the onboarding checklist for the lead attorney when a matter is opened', async () => {
    const m = await newMatter(attorney, await newClient(owner), {
      leadAttorneyId: paralegal.userId,
    });
    const tasks = await waitUntil(
      () => tasksFor(owner, m.id),
      (t) => t.length >= 4,
      90_000,
    );
    expect(tasks.map((t) => t.title).sort()).toEqual([
      'Add key dates to the calendar',
      'Collect initial client documents',
      'Confirm the conflict check result',
      'Send the engagement letter',
    ]);
    expect(
      tasks.every((t) => t.assigneeId === paralegal.userId && t.createdVia === 'workflow'),
    ).toBe(true);
    // The assignee sees them in their own list.
    expect(
      (await paralegal.agent.get(`/v1/tasks?assigneeId=me&matterId=${m.id}`)).body.data,
    ).toHaveLength(4);
  }, 120_000);

  it('never gives restricted-matter work to someone without access', async () => {
    const m = await newMatter(attorney, await newClient(owner), {
      restricted: true,
      title: 'Walled matter',
    });
    const tasks = await waitUntil(
      () => tasksFor(attorney, m.id),
      (t) => t.length >= 4,
      90_000,
    );
    expect(tasks.every((t) => t.assigneeId === attorney.userId)).toBe(true); // the creator, who has access
    expect((await paralegal.agent.get(`/v1/tasks?matterId=${m.id}`)).status).toBe(404);
  }, 120_000);

  it('creates a review task when a document passes the scan, and does not duplicate it on redelivery', async () => {
    const m = await newMatter(attorney, await newClient(owner));
    await waitUntil(
      () => tasksFor(owner, m.id),
      (t) => t.length >= 4,
      90_000,
    ); // onboarding first
    const { docId } = await uploadDocument(app, attorney, m.id, { content: 'Review me.' });
    const review = await waitUntil(
      () => tasksFor(owner, m.id),
      (t) => t.some((x) => x.title === 'Review the newly uploaded document'),
      90_000,
    );
    expect(review.filter((t) => t.title === 'Review the newly uploaded document')).toHaveLength(1);

    // Replay the very same event straight to n8n: the Idempotency-Key makes it a no-op.
    const before = (await tasksFor(owner, m.id)).length;
    const body = JSON.stringify({
      id: 'replay-1',
      event: 'document.scan_clean',
      organizationId: owner.body.organization.id,
      occurredAt: new Date().toISOString(),
      data: { documentId: docId, version: 1, matterId: m.id, uploadedBy: attorney.userId },
    });
    const send = () =>
      fetch(`http://127.0.0.1:${n8nPort}/webhook/assar/document-scan-clean`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-assar-webhook-token': SECRET },
        body,
      });
    expect((await send()).status).toBe(200);
    const after1 = await waitUntil(
      () => tasksFor(owner, m.id),
      (t) => t.length > before,
      30_000,
    );
    const count = after1.length;
    expect((await send()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 4000));
    expect((await tasksFor(owner, m.id)).length).toBe(count);
  }, 240_000);

  it('notifies the requester when an AI draft is ready, linking to it', async () => {
    const m = await newMatter(attorney, await newClient(owner));
    const { docId } = await uploadDocument(app, attorney, m.id, {
      content: 'The term is twelve months.',
    });
    const job = await post(attorney, '/v1/ai/jobs', {
      task: 'summary',
      matterId: m.id,
      documents: [{ documentId: docId }],
    }).expect(202);
    const done = await waitUntil(
      () => attorney.agent.get(`/v1/ai/jobs/${job.body.id}`).then((r) => r.body),
      (j) => j.status === 'succeeded',
    );
    const notes = await waitUntil(
      () =>
        attorney.agent
          .get('/v1/notifications')
          .then(
            (r) => r.body.data as { title: string; link: { type: string; id: string } | null }[],
          ),
      (n) => n.some((x) => x.title === 'An AI draft is ready for review'),
      90_000,
    );
    expect(notes.find((x) => x.title === 'An AI draft is ready for review')!.link).toEqual({
      type: 'ai_output',
      id: done.outputId,
    });
  }, 240_000);

  it('sends reminders once per day however often the schedule runs, and the daily summary once', async () => {
    await post(attorney, '/v1/tasks', {
      title: 'File the response',
      assigneeId: paralegal.userId,
      dueAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    }).expect(201);
    const reminders = async () =>
      (
        (await paralegal.agent.get('/v1/notifications')).body.data as {
          title: string;
          link: { type: string } | null;
        }[]
      ).filter((n) => n.title === 'Reminder: File the response');
    const first = await waitUntil(reminders, (r) => r.length === 1, 60_000);
    expect(first[0]!.link!.type).toBe('task');

    // The schedule fires every 4 s in this test: let it run several more times.
    await new Promise((r) => setTimeout(r, 15_000));
    expect(await reminders()).toHaveLength(1);

    const summaries = async () =>
      (
        (await owner.agent.get('/v1/notifications')).body.data as { title: string; body: string }[]
      ).filter((n) => n.title.startsWith('Daily summary for'));
    const sent = await waitUntil(summaries, (s) => s.length >= 1, 60_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatch(/Open matters: \d+\. Overdue tasks: \d+\./);
    expect(sent[0]!.body).toMatch(/Restricted matters are not included/);
  }, 240_000);
});
