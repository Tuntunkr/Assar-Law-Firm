import type { INestApplication } from '@nestjs/common';
import { AuditLogModel, NotificationModel, TaskModel } from '@assar/database';
import { JobQueues, signEvent } from '@assar/jobs';
import { SERVICE_SCOPES } from '@assar/types';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addMember,
  bearer,
  bootApp,
  createServiceToken,
  del,
  envOf,
  idemKey,
  newClient,
  newMatter,
  patch,
  portalUser,
  post,
  put,
  registerWithMfa,
  startFakeClamd,
  startFakeGrok,
  startFakeN8n,
  startTestWorkers,
  tempStorageDir,
  uniqueEmail,
  uploadDocument,
  waitUntil,
  type Member,
  type Owner,
  type TestWorkers,
} from './helpers';

const SECRET = 'n8n-shared-secret-for-tests-0123456789';
let app: INestApplication;
let clamd: Awaited<ReturnType<typeof startFakeClamd>>;
let grok: Awaited<ReturnType<typeof startFakeGrok>>;
let n8n: Awaited<ReturnType<typeof startFakeN8n>>;
let workers: TestWorkers;
const storage = tempStorageDir();

beforeAll(async () => {
  clamd = await startFakeClamd();
  grok = await startFakeGrok();
  n8n = await startFakeN8n();
  app = await bootApp({
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: storage.dir,
    PUBLIC_API_URL: 'http://api.test',
    AI_ENABLED: 'true',
    WORKFLOWS_ENABLED: 'true',
  });
  workers = startTestWorkers(envOf(app), {
    clamdPort: clamd.port,
    grokUrl: grok.url,
    n8n: { baseUrl: n8n.url, secret: SECRET },
  });
});
afterAll(async () => {
  await workers.close();
  await app.close();
  await n8n.close();
  await grok.close();
  await clamd.close();
  storage.cleanup();
});
afterEach(() => {
  vi.useRealTimers();
  n8n.reset();
});

const ALL = [...SERVICE_SCOPES];
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const iso = (d: Date) => d.toISOString();

async function firm() {
  const owner = await registerWithMfa(app);
  const admin = await addMember(app, owner, 'admin');
  const attorney = await addMember(app, owner, 'attorney');
  const paralegal = await addMember(app, owner, 'paralegal');
  const staff = await addMember(app, owner, 'staff');
  const matter = await newMatter(attorney, await newClient(owner));
  const { token, id } = await createServiceToken(owner, ALL);
  return {
    owner,
    admin,
    attorney,
    paralegal,
    staff,
    matter,
    token,
    tokenId: id,
    svc: bearer(app, token),
    org: owner.body.organization.id as string,
  };
}
const makeTask = (who: Member | Owner, body: object) =>
  post(who, '/v1/tasks', body).then((r) => {
    if (r.status !== 201) throw new Error(`task failed ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as { id: string };
  });

describe('service tokens', () => {
  it('can be managed only by roles with workflow:manage, and show the secret once', async () => {
    const { owner, admin, attorney, paralegal, staff } = await firm();
    for (const who of [attorney, paralegal, staff])
      expect(
        (await post(who, '/v1/service-tokens', { name: 'nope nope', scopes: ['reminders:read'] }))
          .status,
      ).toBe(403);
    expect(
      (await post(owner, '/v1/service-tokens', { name: 'bad scope', scopes: ['admin:everything'] }))
        .status,
    ).toBe(400);
    expect(
      (await post(owner, '/v1/service-tokens', { name: 'no scopes', scopes: [] })).status,
    ).toBe(400);

    const created = await post(admin, '/v1/service-tokens', {
      name: 'Reminders workflow',
      scopes: ['reminders:read', 'notifications:write'],
    }).expect(201);
    expect(created.body.token).toMatch(/^ast_[\w-]{40,}$/);
    expect(created.body).toMatchObject({
      prefix: created.body.token.slice(0, 8),
      scopes: ['reminders:read', 'notifications:write'],
      status: 'active',
    });

    const list = await owner.agent.get('/v1/service-tokens').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(created.body.token);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash/);
    expect((await owner.agent.get('/v1/service-tokens/scopes').expect(200)).body.scopes).toEqual(
      ALL,
    );
    expect((await attorney.agent.get('/v1/service-tokens')).status).toBe(403);
  });

  it('stops working when revoked or expired, and revocation is scoped to the organization', async () => {
    const { owner, svc, token, tokenId } = await firm();
    const other = await firm();
    await svc.get('/v1/automation/reminders/due').expect(200);

    expect((await del(other.owner, `/v1/service-tokens/${tokenId}`)).status).toBe(404); // another firm's admin can't revoke it
    await svc.get('/v1/automation/reminders/due').expect(200);
    await del(owner, `/v1/service-tokens/${tokenId}`).expect(204);
    expect((await svc.get('/v1/automation/reminders/due')).status).toBe(401);
    expect((await del(owner, `/v1/service-tokens/${tokenId}`)).status).toBe(404);
    expect(token).toBeTruthy();

    const short = await createServiceToken(owner, ['reminders:read'], { expiresInDays: 1 });
    await bearer(app, short.token).get('/v1/automation/reminders/due').expect(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
    expect((await bearer(app, short.token).get('/v1/automation/reminders/due')).status).toBe(401);
  });
});

describe('what a service token can and cannot reach', () => {
  it('cannot use any staff, portal or AI endpoint', async () => {
    const { svc, matter } = await firm();
    for (const url of [
      '/v1/auth/me',
      '/v1/matters',
      `/v1/matters/${matter.id}`,
      '/v1/clients',
      '/v1/tasks',
      '/v1/service-tokens',
      '/v1/ai/jobs',
      '/v1/audit-logs',
      '/v1/organization/members',
      '/v1/portal/me',
      '/v1/system/workers',
    ]) {
      expect((await svc.get(url)).status, url).toBe(401);
    }
    expect((await svc.post('/v1/tasks', { title: 'Sneaky task' })).status).toBe(401);
    expect((await svc.post('/v1/service-tokens', { name: 'escalate', scopes: ALL })).status).toBe(
      401,
    );
  });

  it('is limited to its scopes, and reports every failure the same way', async () => {
    const { owner, matter, paralegal } = await firm();
    const { token } = await createServiceToken(owner, ['reminders:read']);
    const only = bearer(app, token);
    await only.get('/v1/automation/reminders/due').expect(200);
    const denied = [
      await only.get(`/v1/automation/matters/${matter.id}/context`),
      await only.get('/v1/automation/reports/daily'),
      await only.post('/v1/automation/notifications', {
        recipientUserId: paralegal.userId,
        title: 'Hello there',
        dedupeKey: 'scope-test-0001',
      }),
      await only.post(
        '/v1/automation/tasks',
        { title: 'Do a thing' },
        { 'idempotency-key': idemKey() },
      ),
    ];
    expect(denied.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    const unknown = await bearer(app, 'ast_' + 'x'.repeat(43)).get('/v1/automation/reminders/due');
    expect(unknown.body.error.message).toBe(denied[0]!.body.error.message); // no hint whether the token exists
  });

  it('does not accept cookies, malformed headers or other principals', async () => {
    const { owner, attorney, slug } = await (async () => {
      const f = await firm();
      return { ...f, slug: f.owner.body.organization.slug as string };
    })();
    const clientId = await newClient(attorney);
    const client = await portalUser(app, attorney, slug, clientId);
    await owner.agent.get('/v1/automation/reminders/due').expect(401);
    await client.agent.get('/v1/automation/reminders/due').expect(401);
    const { token } = await createServiceToken(owner, ['reminders:read']);
    const http = request(app.getHttpServer());
    for (const h of [
      `Basic ${token}`,
      `bearer ${token}`,
      `Bearer ${token} extra`,
      token,
      'Bearer ',
      'Bearer ast_short',
    ]) {
      expect(
        (await http.get('/v1/automation/reminders/due').set('authorization', h)).status,
        h,
      ).toBe(401);
    }
    expect((await http.get('/v1/automation/reminders/due')).status).toBe(401);
  });

  it('only ever acts inside its own organization', async () => {
    const a = await firm();
    const b = await firm();
    expect((await a.svc.get(`/v1/automation/matters/${b.matter.id}/context`)).status).toBe(404);
    expect(
      (
        await a.svc.post(
          '/v1/automation/tasks',
          { title: 'Cross-org task', matterId: b.matter.id },
          { 'idempotency-key': idemKey() },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await a.svc.post('/v1/automation/notifications', {
          recipientUserId: b.attorney.userId,
          title: 'Cross-org note',
          dedupeKey: 'cross-org-0001',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await a.svc.post(
          '/v1/automation/tasks',
          { title: 'Cross-org assignee', assigneeId: b.attorney.userId },
          { 'idempotency-key': idemKey() },
        )
      ).status,
    ).toBe(400);
    const items = (await a.svc.get('/v1/automation/reminders/due?windowHours=168').expect(200)).body
      .items;
    expect(
      items.every((i: { recipientUserId: string }) => i.recipientUserId !== b.attorney.userId),
    ).toBe(true);
  });
});

describe('reminders', () => {
  it('lists upcoming items for entitled recipients only', async () => {
    const { owner, attorney, paralegal, staff, matter, svc } = await firm();
    const t1 = await makeTask(attorney, {
      title: 'Due in two hours',
      assigneeId: paralegal.userId,
      dueAt: hours(2),
      matterId: matter.id,
    });
    const t2 = await makeTask(attorney, {
      title: 'Due in thirty hours',
      assigneeId: paralegal.userId,
      dueAt: hours(30),
    });
    const t3 = await makeTask(attorney, {
      title: 'Overdue by two hours',
      assigneeId: paralegal.userId,
      dueAt: hours(-2),
    });
    await makeTask(attorney, {
      title: 'Overdue by three days',
      assigneeId: paralegal.userId,
      dueAt: hours(-72),
    });
    const done = await makeTask(attorney, {
      title: 'Already done',
      assigneeId: paralegal.userId,
      dueAt: hours(1),
    });
    await patch(paralegal, `/v1/tasks/${done.id}`, { status: 'done' }).expect(200);
    await makeTask(attorney, { title: 'Unassigned', dueAt: hours(1) });
    const gone = await makeTask(attorney, {
      title: 'Assignee later removed',
      assigneeId: staff.userId,
      dueAt: hours(1),
    });
    await patch(owner, `/v1/organization/members/${staff.userId}`, { status: 'disabled' }).expect(
      200,
    );

    const ev = (title: string, extra: object) =>
      post(attorney, '/v1/calendar/events', {
        kind: 'meeting',
        title,
        startsAt: hours(3),
        ...extra,
      });
    const e1 = (await ev('Client call', { attendeeIds: [paralegal.userId, attorney.userId] }).then(
      (r) => r.body,
    )) as { id: string };
    const cancelled = (await ev('Cancelled call', { attendeeIds: [attorney.userId] }).then(
      (r) => r.body,
    )) as { id: string };
    await patch(attorney, `/v1/calendar/events/${cancelled.id}`, { status: 'cancelled' }).expect(
      200,
    );
    await ev('No attendees', {}).then((r) => expect(r.status).toBe(201));
    await ev('Far away', { startsAt: hours(30), attendeeIds: [attorney.userId] }).then((r) =>
      expect(r.status).toBe(201),
    );

    const res = await svc.get('/v1/automation/reminders/due?windowHours=24').expect(200);
    const rows = res.body.items as {
      kind: string;
      itemId: string;
      recipientUserId: string;
      title: string;
      dedupeKey: string;
      matterId: string | null;
    }[];
    const key = (r: (typeof rows)[number]) => `${r.kind}:${r.itemId}:${r.recipientUserId}`;
    expect(rows.map(key).sort()).toEqual(
      [
        `task:${t1.id}:${paralegal.userId}`,
        `task:${t3.id}:${paralegal.userId}`,
        `event:${e1.id}:${paralegal.userId}`,
        `event:${e1.id}:${attorney.userId}`,
      ].sort(),
    );
    expect(rows.find((r) => r.itemId === t1.id)).toMatchObject({
      title: 'Due in two hours',
      matterId: matter.id,
    });
    expect(rows.find((r) => r.itemId === t1.id)!.dedupeKey).toMatch(
      new RegExp(`^task:${t1.id}:${paralegal.userId}:\\d{4}-\\d{2}-\\d{2}$`),
    );
    expect(rows.some((r) => r.itemId === gone.id)).toBe(false);

    const wide = (await svc.get('/v1/automation/reminders/due?windowHours=48').expect(200)).body
      .items as typeof rows;
    expect(wide.some((r) => r.itemId === t2.id)).toBe(true);
    expect((await svc.get('/v1/automation/reminders/due?windowHours=0')).status).toBe(400);
    expect((await svc.get('/v1/automation/reminders/due?windowHours=999')).status).toBe(400);
  });

  it('stops listing items on a restricted matter for someone who lost access', async () => {
    const { owner, attorney, paralegal, svc } = await firm();
    const secret = await newMatter(attorney, await newClient(owner), {
      title: 'Walled',
      restricted: true,
    });
    await put(owner, `/v1/matters/${secret.id}/access`, {
      restricted: true,
      userIds: [attorney.userId, paralegal.userId],
    }).expect(200);
    const mine = await makeTask(attorney, {
      title: 'Walled task for attorney',
      assigneeId: attorney.userId,
      dueAt: hours(1),
      matterId: secret.id,
    });
    const theirs = await makeTask(attorney, {
      title: 'Walled task for paralegal',
      assigneeId: paralegal.userId,
      dueAt: hours(1),
      matterId: secret.id,
    });

    const before = (await svc.get('/v1/automation/reminders/due').expect(200)).body.items.map(
      (i: { itemId: string }) => i.itemId,
    );
    expect(before).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    await put(owner, `/v1/matters/${secret.id}/access`, {
      restricted: true,
      userIds: [attorney.userId],
    }).expect(200);
    const after = (await svc.get('/v1/automation/reminders/due').expect(200)).body.items.map(
      (i: { itemId: string }) => i.itemId,
    );
    expect(after).toContain(mine.id);
    expect(after).not.toContain(theirs.id);
  });
});

describe('notifications', () => {
  it('creates idempotent in-app notifications that only the recipient can read', async () => {
    const { attorney, paralegal, staff, svc, org } = await firm();
    const body = {
      recipientUserId: paralegal.userId,
      title: 'Task due soon',
      body: 'Please review',
      dedupeKey: 'reminder-key-0001',
    };
    expect((await svc.post('/v1/automation/notifications', body).expect(200)).body.created).toBe(
      true,
    );
    const again = await svc.post('/v1/automation/notifications', body).expect(200);
    expect(again.body.created).toBe(false);
    expect(
      await NotificationModel.countDocuments({ organizationId: org, userId: paralegal.userId }),
    ).toBe(1);

    const mine = await paralegal.agent.get('/v1/notifications').expect(200);
    expect(mine.body).toMatchObject({
      unread: 1,
      data: [{ title: 'Task due soon', body: 'Please review', read: false, source: 'workflow' }],
    });
    expect((await attorney.agent.get('/v1/notifications').expect(200)).body.data).toEqual([]);
    expect((await post(attorney, `/v1/notifications/${again.body.id}/read`, {})).status).toBe(404); // not theirs
    expect((await staff.agent.get('/v1/notifications').expect(200)).body.unread).toBe(0);

    await post(paralegal, `/v1/notifications/${again.body.id}/read`, {}).expect(200);
    expect(
      (await paralegal.agent.get('/v1/notifications?unread=true').expect(200)).body.data,
    ).toEqual([]);
    expect((await paralegal.agent.get('/v1/notifications').expect(200)).body.unread).toBe(0);
  });

  it('paginates and marks everything read', async () => {
    const { paralegal, svc } = await firm();
    for (let i = 0; i < 3; i++)
      await svc
        .post('/v1/automation/notifications', {
          recipientUserId: paralegal.userId,
          title: `Note ${i}`,
          dedupeKey: `bulk-note-000${i}`,
        })
        .expect(200);
    const p1 = await paralegal.agent.get('/v1/notifications?limit=2').expect(200);
    const p2 = await paralegal.agent
      .get(`/v1/notifications?limit=2&cursor=${p1.body.page.nextCursor}`)
      .expect(200);
    expect([...p1.body.data, ...p2.body.data].map((n: { title: string }) => n.title)).toEqual([
      'Note 2',
      'Note 1',
      'Note 0',
    ]);
    expect((await post(paralegal, '/v1/notifications/read-all', {}).expect(200)).body.unread).toBe(
      0,
    );
    expect(
      (await paralegal.agent.get('/v1/notifications?unread=true').expect(200)).body.data,
    ).toEqual([]);
  });

  it('refuses to point someone at an item they are not allowed to open', async () => {
    const { owner, attorney, paralegal, svc } = await firm();
    const secret = await newMatter(attorney, await newClient(owner), { restricted: true });
    const task = await makeTask(attorney, {
      title: 'Walled task',
      assigneeId: attorney.userId,
      matterId: secret.id,
    });
    const note = (recipient: string, link: object, key: string) =>
      svc.post('/v1/automation/notifications', {
        recipientUserId: recipient,
        title: 'Look at this',
        link,
        dedupeKey: key,
      });

    expect(
      (await note(paralegal.userId, { type: 'matter', id: secret.id }, 'link-key-000001')).status,
    ).toBe(404);
    expect(
      (await note(paralegal.userId, { type: 'task', id: task.id }, 'link-key-000002')).status,
    ).toBe(404);
    expect(
      (await note(attorney.userId, { type: 'task', id: task.id }, 'link-key-000003')).status,
    ).toBe(200);
    expect(
      (await note(attorney.userId, { type: 'task', id: 'a'.repeat(24) }, 'link-key-000004')).status,
    ).toBe(404);
    expect(
      (
        await svc.post('/v1/automation/notifications', {
          recipientUserId: paralegal.userId,
          title: 'x',
          dedupeKey: 'short',
        })
      ).status,
    ).toBe(400);
  });
});

describe('automation tasks', () => {
  it('creates idempotent, clearly-attributed tasks', async () => {
    const { attorney, paralegal, matter, svc, tokenId, owner } = await firm();
    const body = {
      title: 'Review new document',
      matterId: matter.id,
      assigneeId: paralegal.userId,
      priority: 'high',
      dueAt: hours(48),
    };
    expect((await svc.post('/v1/automation/tasks', body)).status).toBe(400); // an Idempotency-Key is required
    const key = idemKey();
    const first = await svc
      .post('/v1/automation/tasks', body, { 'idempotency-key': key })
      .expect(201);
    const replay = await svc
      .post('/v1/automation/tasks', body, { 'idempotency-key': key })
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({
      createdVia: 'workflow',
      createdBy: tokenId,
      assigneeId: paralegal.userId,
      priority: 'high',
      status: 'todo',
    });
    expect(
      await TaskModel.countDocuments({ title: 'Review new document', matterId: matter.id }),
    ).toBe(1);
    expect(
      (await paralegal.agent.get('/v1/tasks?assigneeId=me').expect(200)).body.data.map(
        (t: { id: string }) => t.id,
      ),
    ).toContain(first.body.id);

    const audit = (
      await owner.agent.get('/v1/audit-logs?action=automation.task_created').expect(200)
    ).body.data[0];
    expect(audit).toMatchObject({
      actorType: 'service',
      actorId: tokenId,
      targetId: first.body.id,
    });
    expect(
      (
        await svc.post(
          '/v1/automation/tasks',
          { title: 'Bad due date', dueAt: 'tomorrow' },
          { 'idempotency-key': idemKey() },
        )
      ).status,
    ).toBe(400);
    expect(attorney).toBeTruthy();
  });

  it('assigns work on a restricted matter only to people who can see it', async () => {
    const { owner, attorney, paralegal, svc } = await firm();
    const secret = await newMatter(attorney, await newClient(owner), { restricted: true });
    const create = (extra: object) =>
      svc.post(
        '/v1/automation/tasks',
        { title: 'Walled task', matterId: secret.id, ...extra },
        { 'idempotency-key': idemKey() },
      );
    expect((await create({})).status).toBe(400); // unassigned work on a walled matter
    expect((await create({ assigneeId: paralegal.userId })).status).toBe(400); // assignee has no access
    expect((await create({ assigneeId: attorney.userId })).status).toBe(201);
  });
});

describe('matter context & daily report', () => {
  it('withholds identifying details of restricted matters', async () => {
    const { owner, attorney, matter, svc } = await firm();
    const open = (await svc.get(`/v1/automation/matters/${matter.id}/context`).expect(200)).body;
    expect(open).toMatchObject({
      id: matter.id,
      restricted: false,
      matterNumber: matter.matterNumber,
      title: 'Sample Matter',
      createdBy: attorney.userId,
    });
    const secret = await newMatter(attorney, await newClient(owner), {
      title: 'Highly Sensitive Merger',
      restricted: true,
    });
    const walled = (await svc.get(`/v1/automation/matters/${secret.id}/context`).expect(200)).body;
    expect(walled).toMatchObject({ id: secret.id, restricted: true, createdBy: attorney.userId });
    expect(JSON.stringify(walled)).not.toMatch(/Highly Sensitive|matterNumber|title/);
    expect((await svc.get(`/v1/automation/matters/${'c'.repeat(24)}/context`)).status).toBe(404);
  });

  it('reports counts only, leaves out restricted matters, and addresses owners and admins', async () => {
    const { owner, admin, attorney, paralegal, svc } = await firm(); // one open matter
    const clientId = await newClient(owner);
    await newMatter(attorney, clientId, { title: 'Second open matter' });
    const secret = await newMatter(attorney, clientId, {
      title: 'Walled matter',
      restricted: true,
    });
    await makeTask(attorney, {
      title: 'Overdue open task',
      assigneeId: paralegal.userId,
      dueAt: hours(-5),
    });
    await makeTask(attorney, {
      title: 'Overdue walled task',
      assigneeId: attorney.userId,
      dueAt: hours(-5),
      matterId: secret.id,
    });
    await post(attorney, '/v1/calendar/events', {
      kind: 'deadline',
      title: 'Filing deadline',
      startsAt: hours(48),
    }).expect(201);
    await post(attorney, '/v1/calendar/events', {
      kind: 'deadline',
      title: 'Walled deadline',
      startsAt: hours(48),
      matterId: secret.id,
    }).expect(201);

    const rep = (await svc.get('/v1/automation/reports/daily').expect(200)).body;
    expect(rep.counts).toEqual({
      openMatters: 2,
      overdueTasks: 1,
      upcomingDeadlines: 1,
      pendingDrafts: 0,
      scanFailures: 0,
    });
    expect(rep.restrictedMattersExcluded).toBe(true);
    expect(rep.recipients.sort()).toEqual([owner.body.user.id, admin.userId].sort());
    expect(JSON.stringify(rep)).not.toMatch(/Walled|Overdue|Filing|title/);
  });
});

describe('workflow events', () => {
  const forOrg = (org: string) => n8n.requests.filter((r) => r.body.organizationId === org);

  it('delivers signed, id-only events to n8n when a matter is created', async () => {
    const { attorney, org, owner } = await firm();
    const clientId = await newClient(owner);
    n8n.reset();
    const m = await newMatter(attorney, clientId, {
      title: 'Confidential Acquisition Strategy',
      description: 'Very secret details',
    });
    const [req] = await waitUntil(
      () => forOrg(org).filter((r) => r.body.event === 'matter.created'),
      (r) => r.length === 1,
    );
    expect(req!.body).toMatchObject({
      event: 'matter.created',
      organizationId: org,
      data: { matterId: m.id, createdBy: attorney.userId, restricted: false },
    });
    expect(req!.body.id).toBeTruthy();
    expect(req!.path).toBe('/webhook/assar/matter-created'); // one webhook path per event, so each workflow owns one
    expect(req!.raw).not.toMatch(/Confidential|secret|Acquisition/); // ids only, never content

    const h = req!.headers;
    expect(h['x-assar-webhook-token']).toBe(SECRET);
    expect(h['x-assar-event']).toBe('matter.created');
    expect(h['x-assar-signature']).toBe(
      signEvent(SECRET, String(h['x-assar-timestamp']), req!.raw),
    );
    expect(Math.abs(Date.now() / 1000 - Number(h['x-assar-timestamp']))).toBeLessThan(60);
  });

  it('marks restricted matters in the event without naming them', async () => {
    const { attorney, org, owner } = await firm();
    n8n.reset();
    await newMatter(attorney, await newClient(owner), { title: 'Walled Deal', restricted: true });
    const [req] = await waitUntil(
      () => forOrg(org).filter((r) => r.body.event === 'matter.created'),
      (r) => r.length >= 1,
    );
    expect(req!.body.data.restricted).toBe(true);
    expect(req!.raw).not.toMatch(/Walled Deal/);
  });

  it('announces clean documents and finished AI drafts', async () => {
    const { attorney, org, matter } = await firm();
    n8n.reset();
    const { docId } = await uploadDocument(app, attorney, matter.id, {
      content: 'The term is twelve months.\nSecond line.',
    });
    const [scanned] = await waitUntil(
      () => forOrg(org).filter((r) => r.body.event === 'document.scan_clean'),
      (r) => r.length === 1,
    );
    expect(scanned!.path).toBe('/webhook/assar/document-scan-clean');
    expect(scanned!.body.data).toMatchObject({
      documentId: docId,
      version: 1,
      matterId: matter.id,
      uploadedBy: attorney.userId,
    });

    const job = await post(attorney, '/v1/ai/jobs', {
      task: 'summary',
      matterId: matter.id,
      documents: [{ documentId: docId }],
    }).expect(202);
    const [ready] = await waitUntil(
      () => forOrg(org).filter((r) => r.body.event === 'ai.output_ready'),
      (r) => r.length === 1,
    );
    expect(ready!.path).toBe('/webhook/assar/ai-output-ready');
    expect(ready!.body.data).toMatchObject({
      jobId: job.body.id,
      matterId: matter.id,
      requestedBy: attorney.userId,
      task: 'summary',
    });
    expect(ready!.raw).not.toMatch(/twelve months|Key point/);
  });

  it('retries transient receiver failures and gives up on rejections', async () => {
    const { attorney, org, owner } = await firm();
    const clientId = await newClient(owner);
    n8n.reset();
    n8n.respondWith(500, 503);
    await newMatter(attorney, clientId);
    const tries = await waitUntil(
      () => forOrg(org),
      (r) => r.length >= 3,
    );
    expect(tries).toHaveLength(3);
    expect(new Set(tries.map((t) => t.body.id)).size).toBe(1); // the same event, redelivered

    n8n.reset();
    n8n.respondWith(400);
    await newMatter(attorney, clientId);
    await waitUntil(
      () => forOrg(org),
      (r) => r.length >= 1,
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(forOrg(org)).toHaveLength(1); // a 4xx is final: not retried
  });

  it('publishes nothing when workflows are disabled', async () => {
    const env = envOf(app);
    const off = new JobQueues({
      redisUrl: env.REDIS_URL,
      prefix: `${env.QUEUE_PREFIX}-off`,
      eventsEnabled: false,
    });
    try {
      await off.publish({ event: 'matter.created', organizationId: 'x', data: {} });
      expect((await off.counts()).events).toMatchObject({ waiting: 0, active: 0, delayed: 0 });
    } finally {
      await off.close();
    }
  });
});

describe('auditing', () => {
  it('attributes service actions to the token, and keeps secrets out of the log', async () => {
    const { owner, svc, tokenId, token, paralegal } = await firm();
    await svc.get('/v1/automation/reminders/due').expect(200);
    await svc
      .post('/v1/automation/notifications', {
        recipientUserId: paralegal.userId,
        title: 'Audit me',
        dedupeKey: 'audit-key-0001',
      })
      .expect(200);
    const logs = (await owner.agent.get('/v1/audit-logs?limit=100').expect(200)).body.data as {
      action: string;
      actorType: string;
      actorId: string;
    }[];
    const svcLogs = logs.filter((l) => l.actorType === 'service');
    expect(svcLogs.map((l) => l.action)).toEqual(
      expect.arrayContaining(['automation.reminders_read', 'automation.notification_created']),
    );
    expect(svcLogs.every((l) => l.actorId === tokenId)).toBe(true);
    expect(logs.find((l) => l.action === 'service_token.created')!.actorType).toBe('staff');
    expect(
      JSON.stringify(
        await AuditLogModel.find({ organizationId: owner.body.organization.id }).lean(),
      ),
    ).not.toContain(token);
    expect(uniqueEmail()).toBeTruthy();
    void iso;
  });
});
