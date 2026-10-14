import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bootApp,
  del,
  newClient,
  newMatter,
  patch,
  post,
  put,
  registerWithMfa,
} from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await app.close();
});

const titles = (res: { body: { data: { title: string }[] } }) => res.body.data.map((t) => t.title);
const task = (title: string, extra: object = {}) => ({ title, ...extra });

describe('tasks', () => {
  it('creates, assigns, completes and reopens tasks', async () => {
    const owner = await registerWithMfa(app);
    const paralegal = await addMember(app, owner, 'paralegal');
    const matter = await newMatter(owner, await newClient(owner));
    const t = (
      await post(
        owner,
        '/v1/tasks',
        task('Draft cover letter', {
          matterId: matter.id,
          assigneeId: paralegal.userId,
          priority: 'high',
          dueAt: '2031-02-01T17:00:00Z',
        }),
      ).expect(201)
    ).body;
    expect(t).toMatchObject({
      status: 'todo',
      priority: 'high',
      assigneeId: paralegal.userId,
      matterId: matter.id,
      completedAt: null,
    });

    const done = await patch(paralegal, `/v1/tasks/${t.id}`, { status: 'done' }).expect(200);
    expect(done.body.completedAt).toBeTruthy();
    const reopened = await patch(paralegal, `/v1/tasks/${t.id}`, { status: 'in_progress' }).expect(
      200,
    );
    expect(reopened.body.completedAt).toBeNull();

    await patch(owner, `/v1/tasks/${t.id}`, { assigneeId: null, dueAt: null }).expect(200);
    expect((await owner.agent.get(`/v1/tasks/${t.id}`).expect(200)).body).toMatchObject({
      assigneeId: null,
      dueAt: null,
    });
    await del(owner, `/v1/tasks/${t.id}`).expect(204);
    expect((await owner.agent.get(`/v1/tasks/${t.id}`)).status).toBe(404);
  });

  it('validates input and assignees', async () => {
    const owner = await registerWithMfa(app);
    const other = await registerWithMfa(app, 'Other');
    const stranger = await addMember(app, other, 'staff');
    expect((await post(owner, '/v1/tasks', task('x'))).status).toBe(400); // title too short
    expect(
      (await post(owner, '/v1/tasks', task('Valid title', { priority: 'urgent' }))).status,
    ).toBe(400);
    expect(
      (await post(owner, '/v1/tasks', task('Valid title', { dueAt: 'tomorrow' }))).status,
    ).toBe(400);
    expect(
      (await post(owner, '/v1/tasks', task('Valid title', { assigneeId: stranger.userId }))).status,
    ).toBe(400); // other org
    expect(
      (await post(owner, '/v1/tasks', task('Valid title', { matterId: 'a'.repeat(24) }))).status,
    ).toBe(404);
  });

  it('filters by assignee (including "me"), status, matter and due date, and paginates', async () => {
    const owner = await registerWithMfa(app);
    const paralegal = await addMember(app, owner, 'paralegal');
    const matter = await newMatter(owner, await newClient(owner));
    await post(
      owner,
      '/v1/tasks',
      task('Mine early', { assigneeId: paralegal.userId, dueAt: '2031-01-05T00:00:00Z' }),
    ).expect(201);
    await post(
      owner,
      '/v1/tasks',
      task('Mine late', {
        assigneeId: paralegal.userId,
        dueAt: '2031-03-05T00:00:00Z',
        matterId: matter.id,
      }),
    ).expect(201);
    const done = (
      await post(owner, '/v1/tasks', task('Mine done', { assigneeId: paralegal.userId })).expect(
        201,
      )
    ).body;
    await patch(owner, `/v1/tasks/${done.id}`, { status: 'done' }).expect(200);
    await post(owner, '/v1/tasks', task('Someone else')).expect(201);

    expect(titles(await paralegal.agent.get('/v1/tasks?assigneeId=me').expect(200)).sort()).toEqual(
      ['Mine done', 'Mine early', 'Mine late'],
    );
    expect(
      titles(await paralegal.agent.get('/v1/tasks?assigneeId=me&status=todo').expect(200)).sort(),
    ).toEqual(['Mine early', 'Mine late']);
    expect(titles(await owner.agent.get(`/v1/tasks?matterId=${matter.id}`).expect(200))).toEqual([
      'Mine late',
    ]);
    expect(
      titles(
        await owner.agent
          .get(`/v1/tasks?dueBefore=${encodeURIComponent('2031-02-01T00:00:00Z')}`)
          .expect(200),
      ),
    ).toEqual(['Mine early']);

    const p1 = await owner.agent.get('/v1/tasks?limit=3').expect(200);
    const p2 = await owner.agent
      .get(`/v1/tasks?limit=3&cursor=${p1.body.page.nextCursor}`)
      .expect(200);
    expect([...titles(p1), ...titles(p2)]).toHaveLength(4);
    expect(p2.body.page.nextCursor).toBeNull();
  });

  it('allows task:write roles to change tasks but keeps billing read-only', async () => {
    const owner = await registerWithMfa(app);
    const staff = await addMember(app, owner, 'staff');
    const billing = await addMember(app, owner, 'billing');
    const t = (await post(staff, '/v1/tasks', task('Staff task')).expect(201)).body;
    expect((await billing.agent.get(`/v1/tasks/${t.id}`)).status).toBe(200);
    expect((await post(billing, '/v1/tasks', task('Billing task'))).status).toBe(403);
    expect((await patch(billing, `/v1/tasks/${t.id}`, { status: 'done' })).status).toBe(403);
    expect((await del(billing, `/v1/tasks/${t.id}`)).status).toBe(403);
  });
});

describe('task visibility', () => {
  async function setup() {
    const owner = await registerWithMfa(app);
    const alice = await addMember(app, owner, 'attorney');
    const bob = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const open = await newMatter(alice, clientId, { title: 'Open Matter' });
    const secret = await newMatter(alice, clientId, { title: 'Secret Matter', restricted: true });
    return { owner, alice, bob, open, secret };
  }

  it('hides tasks on restricted matters from users without access', async () => {
    const { owner, alice, bob, open, secret } = await setup();
    await post(alice, '/v1/tasks', task('Org-level task')).expect(201);
    await post(alice, '/v1/tasks', task('Open task', { matterId: open.id })).expect(201);
    const hidden = (
      await post(alice, '/v1/tasks', task('Secret task', { matterId: secret.id })).expect(201)
    ).body;

    expect(titles(await bob.agent.get('/v1/tasks').expect(200)).sort()).toEqual([
      'Open task',
      'Org-level task',
    ]);
    expect(titles(await alice.agent.get('/v1/tasks').expect(200))).toContain('Secret task');
    expect(titles(await owner.agent.get('/v1/tasks').expect(200))).toContain('Secret task');

    expect((await bob.agent.get(`/v1/tasks?matterId=${secret.id}`)).status).toBe(404);
    const direct = await bob.agent.get(`/v1/tasks/${hidden.id}`);
    const missing = await bob.agent.get(`/v1/tasks/${'f'.repeat(24)}`);
    expect(direct.status).toBe(404);
    expect(direct.body.error.message).toBe(missing.body.error.message);
    expect((await patch(bob, `/v1/tasks/${hidden.id}`, { status: 'done' })).status).toBe(404);
    expect((await del(bob, `/v1/tasks/${hidden.id}`)).status).toBe(404);
    expect(
      (await post(bob, '/v1/tasks', task('Planted task', { matterId: secret.id }))).status,
    ).toBe(404);
  });

  it('refuses to assign restricted-matter work to someone who cannot see the matter', async () => {
    const { owner, alice, bob, secret, open } = await setup();
    expect(
      (
        await post(
          alice,
          '/v1/tasks',
          task('Leak attempt', { matterId: secret.id, assigneeId: bob.userId }),
        )
      ).status,
    ).toBe(400);

    // Existing assignee + moving the task onto a restricted matter is re-validated too.
    const t = (
      await post(
        alice,
        '/v1/tasks',
        task('Assigned to Bob', { matterId: open.id, assigneeId: bob.userId }),
      ).expect(201)
    ).body;
    expect((await patch(alice, `/v1/tasks/${t.id}`, { matterId: secret.id })).status).toBe(400);
    expect(
      (await patch(alice, `/v1/tasks/${t.id}`, { matterId: secret.id, assigneeId: alice.userId }))
        .status,
    ).toBe(200);
    expect((await patch(alice, `/v1/tasks/${t.id}`, { assigneeId: bob.userId })).status).toBe(400);

    await put(owner, `/v1/matters/${secret.id}/access`, {
      restricted: true,
      userIds: [alice.userId, bob.userId],
    }).expect(200);
    expect((await patch(alice, `/v1/tasks/${t.id}`, { assigneeId: bob.userId })).status).toBe(200);
  });

  it('stops showing a task when its assignee loses access to the matter', async () => {
    const { owner, alice, bob, secret } = await setup();
    await put(owner, `/v1/matters/${secret.id}/access`, {
      restricted: true,
      userIds: [alice.userId, bob.userId],
    }).expect(200);
    await post(
      alice,
      '/v1/tasks',
      task('Bob’s secret task', { matterId: secret.id, assigneeId: bob.userId }),
    ).expect(201);
    expect(titles(await bob.agent.get('/v1/tasks?assigneeId=me').expect(200))).toEqual([
      'Bob’s secret task',
    ]);
    await put(owner, `/v1/matters/${secret.id}/access`, {
      restricted: true,
      userIds: [alice.userId],
    }).expect(200);
    expect(titles(await bob.agent.get('/v1/tasks?assigneeId=me').expect(200))).toEqual([]);
  });

  it('paginates correctly when hidden tasks are filtered out', async () => {
    const { alice, bob, secret } = await setup();
    for (let i = 0; i < 3; i++) {
      await post(alice, '/v1/tasks', task(`Visible ${i}`)).expect(201);
      await post(alice, '/v1/tasks', task(`Hidden ${i}`, { matterId: secret.id })).expect(201);
    }
    const p1 = await bob.agent.get('/v1/tasks?limit=2').expect(200);
    const p2 = await bob.agent
      .get(`/v1/tasks?limit=2&cursor=${p1.body.page.nextCursor}`)
      .expect(200);
    expect([...titles(p1), ...titles(p2)].sort()).toEqual(['Visible 0', 'Visible 1', 'Visible 2']);
  });
});

describe('task organization isolation', () => {
  it('never exposes or accepts another organization’s tasks', async () => {
    const a = await registerWithMfa(app, 'Alpha');
    const b = await registerWithMfa(app, 'Beta');
    const matterA = await newMatter(a, await newClient(a));
    const taskA = (
      await post(a, '/v1/tasks', task('Alpha task', { matterId: matterA.id })).expect(201)
    ).body;

    expect(titles(await b.agent.get('/v1/tasks').expect(200))).toEqual([]);
    expect(titles(await b.agent.get(`/v1/tasks?assigneeId=${a.body.user.id}`).expect(200))).toEqual(
      [],
    );
    expect((await b.agent.get(`/v1/tasks/${taskA.id}`)).status).toBe(404);
    expect((await patch(b, `/v1/tasks/${taskA.id}`, { status: 'done' })).status).toBe(404);
    expect((await del(b, `/v1/tasks/${taskA.id}`)).status).toBe(404);
    expect(
      (await post(b, '/v1/tasks', task('Planted task', { matterId: matterA.id }))).status,
    ).toBe(404);
    expect(
      (await post(b, '/v1/tasks', task('Planted task', { assigneeId: a.body.user.id }))).status,
    ).toBe(400);
    expect((await a.agent.get(`/v1/tasks/${taskA.id}`).expect(200)).body.status).toBe('todo');
  });
});
