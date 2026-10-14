import type { INestApplication } from '@nestjs/common';
import { MatterModel } from '@assar/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bootApp,
  del,
  idemKey,
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

const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((m) => m.id);

describe('matters', () => {
  it('numbers matters sequentially per organization, even under concurrent creation', async () => {
    const a = await registerWithMfa(app, 'Alpha');
    const b = await registerWithMfa(app, 'Beta');
    const clientA = await newClient(a);
    const results = await Promise.all(Array.from({ length: 5 }, () => newMatter(a, clientA)));
    const numbers = results.map((m) => m.matterNumber).sort();
    expect(new Set(numbers).size).toBe(5);
    expect(numbers[0]).toMatch(/^M-\d{4}-00001$/);
    expect(numbers[4]).toMatch(/^M-\d{4}-00005$/);

    const first = await newMatter(b, await newClient(b));
    expect(first.matterNumber).toMatch(/-00001$/); // independent counter per organization
  });

  it('enforces role permissions on matters', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const staff = await addMember(app, owner, 'staff');
    const clientId = await newClient(owner);

    const m = await newMatter(attorney, clientId, { title: 'Attorney Matter' });
    expect((await staff.agent.get(`/v1/matters/${m.id}`)).status).toBe(200);
    expect(
      (await post(staff, '/v1/matters', { clientId, title: 'Nope Matter', practiceArea: 'tax' }))
        .status,
    ).toBe(403);
    expect((await patch(staff, `/v1/matters/${m.id}`, { title: 'Changed Title' })).status).toBe(
      403,
    );
  });

  it('validates references: client, lead attorney and bad enum values', async () => {
    const owner = await registerWithMfa(app);
    const clientId = await newClient(owner);
    const body = { clientId, title: 'Ref Matter', practiceArea: 'tax' };
    expect((await post(owner, '/v1/matters', { ...body, clientId: 'b'.repeat(24) })).status).toBe(
      404,
    );
    expect(
      (await post(owner, '/v1/matters', { ...body, leadAttorneyId: 'c'.repeat(24) })).status,
    ).toBe(400);
    expect((await post(owner, '/v1/matters', { ...body, practiceArea: 'astrology' })).status).toBe(
      400,
    );
  });

  it('lists with filters and tracks closing/reopening', async () => {
    const owner = await registerWithMfa(app);
    const c1 = await newClient(owner, 'First Client');
    const c2 = await newClient(owner, 'Second Client');
    const m1 = await newMatter(owner, c1, { title: 'Zoning Dispute' });
    const m2 = await newMatter(owner, c2, { title: 'Merger Review' });

    expect(ids(await owner.agent.get(`/v1/matters?clientId=${c1}`).expect(200))).toEqual([m1.id]);
    expect(ids(await owner.agent.get('/v1/matters?q=zon').expect(200))).toEqual([m1.id]);
    expect(
      ids(await owner.agent.get(`/v1/matters?q=${m2.matterNumber.toLowerCase()}`).expect(200)),
    ).toEqual([m2.id]);

    const closed = await patch(owner, `/v1/matters/${m1.id}`, { status: 'closed' }).expect(200);
    expect(closed.body.closedAt).toBeTruthy();
    expect(ids(await owner.agent.get('/v1/matters?status=closed').expect(200))).toEqual([m1.id]);
    const reopened = await patch(owner, `/v1/matters/${m1.id}`, { status: 'open' }).expect(200);
    expect(reopened.body.closedAt).toBeNull();
    expect((await patch(owner, `/v1/matters/${m1.id}`, {})).status).toBe(400);
  });

  it('is idempotent and does not burn matter numbers on replay', async () => {
    const owner = await registerWithMfa(app);
    const clientId = await newClient(owner);
    const key = idemKey();
    const send = () =>
      owner.agent
        .post('/v1/matters')
        .set('x-csrf-token', owner.csrf)
        .set('idempotency-key', key)
        .send({ clientId, title: 'Idempotent Matter', practiceArea: 'tax' });
    const first = await send().expect(201);
    const second = await send().expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await MatterModel.countDocuments({ clientId })).toBe(1);
    const next = await newMatter(owner, clientId);
    expect(next.matterNumber).toMatch(/-00002$/);
  });

  it('manages parties and keeps them bound to their matter', async () => {
    const owner = await registerWithMfa(app);
    const clientId = await newClient(owner);
    const m1 = await newMatter(owner, clientId);
    const m2 = await newMatter(owner, clientId);

    const party = (
      await post(owner, `/v1/matters/${m1.id}/parties`, {
        name: 'Robert Roe',
        type: 'individual',
        role: 'opposing_party',
      }).expect(201)
    ).body;
    expect(
      (await owner.agent.get(`/v1/matters/${m1.id}/parties`).expect(200)).body.data,
    ).toHaveLength(1);
    expect(
      (
        await patch(owner, `/v1/matters/${m1.id}/parties/${party.id}`, { role: 'witness' }).expect(
          200,
        )
      ).body.role,
    ).toBe('witness');
    // The party id doesn't resolve through a different matter.
    expect(
      (await patch(owner, `/v1/matters/${m2.id}/parties/${party.id}`, { role: 'expert' })).status,
    ).toBe(404);
    expect((await del(owner, `/v1/matters/${m2.id}/parties/${party.id}`)).status).toBe(404);
    await del(owner, `/v1/matters/${m1.id}/parties/${party.id}`).expect(204);
    expect(
      (await owner.agent.get(`/v1/matters/${m1.id}/parties`).expect(200)).body.data,
    ).toHaveLength(0);
    expect(
      (
        await post(owner, `/v1/matters/${m1.id}/parties`, {
          name: 'X',
          type: 'individual',
          role: 'witness',
        })
      ).status,
    ).toBe(400);
  });
});

describe('restricted matters', () => {
  async function setup() {
    const owner = await registerWithMfa(app);
    const [alice, bob] = [
      await addMember(app, owner, 'attorney'),
      await addMember(app, owner, 'attorney'),
    ];
    const admin = await addMember(app, owner, 'admin');
    const clientId = await newClient(owner, 'Wall Client');
    return { owner, alice, bob, admin, clientId };
  }

  it('hides a restricted matter from everyone not on its access list — admins included', async () => {
    const { owner, alice, bob, admin, clientId } = await setup();
    const open = await newMatter(alice, clientId, { title: 'Open Matter' });
    const secret = await newMatter(alice, clientId, { title: 'Secret Matter', restricted: true });

    // Alice (creator) sees both; Bob and the admin see only the open one.
    expect(ids(await alice.agent.get('/v1/matters').expect(200)).sort()).toEqual(
      [open.id, secret.id].sort(),
    );
    for (const outsider of [bob, admin]) {
      expect(ids(await outsider.agent.get('/v1/matters').expect(200))).toEqual([open.id]);
      expect((await outsider.agent.get(`/v1/matters/${secret.id}`)).status).toBe(404);
      expect(
        (await patch(outsider, `/v1/matters/${secret.id}`, { title: 'Defaced Title' })).status,
      ).toBe(404);
      expect((await outsider.agent.get(`/v1/matters/${secret.id}/parties`)).status).toBe(404);
      expect(
        (
          await post(outsider, `/v1/matters/${secret.id}/parties`, {
            name: 'Sneaky Party',
            type: 'individual',
            role: 'witness',
          })
        ).status,
      ).toBe(404);
      expect((await outsider.agent.get(`/v1/matters/${secret.id}/access`)).status).toBe(404);
      expect(
        (await put(outsider, `/v1/matters/${secret.id}/access`, { restricted: false, userIds: [] }))
          .status,
      ).toBe(404);
    }
    // 404 is identical to a matter that doesn't exist: no existence leak.
    const missing = await bob.agent.get(`/v1/matters/${'d'.repeat(24)}`);
    const hidden = await bob.agent.get(`/v1/matters/${secret.id}`);
    expect(hidden.status).toBe(missing.status);
    expect(hidden.body.error.message).toBe(missing.body.error.message);

    // The owner has audited break-glass access.
    expect((await owner.agent.get(`/v1/matters/${secret.id}`)).status).toBe(200);
    const logs = await owner.agent
      .get('/v1/audit-logs?action=matter.restricted_accessed_by_owner')
      .expect(200);
    expect(logs.body.data[0].targetId).toBe(secret.id);
  });

  it('paginates correctly when restricted rows are filtered out', async () => {
    const { alice, bob, clientId } = await setup();
    const visible: string[] = [];
    for (let i = 0; i < 3; i++) {
      visible.push((await newMatter(alice, clientId, { title: `Open ${i} Matter` })).id);
      await newMatter(alice, clientId, { title: `Hidden ${i} Matter`, restricted: true });
    }
    const p1 = await bob.agent.get('/v1/matters?limit=2').expect(200);
    const p2 = await bob.agent
      .get(`/v1/matters?limit=2&cursor=${p1.body.page.nextCursor}`)
      .expect(200);
    expect([...ids(p1), ...ids(p2)].sort()).toEqual(visible.sort());
    expect(p2.body.page.nextCursor).toBeNull();
  });

  it('grants and revokes access through the access list', async () => {
    const { owner, alice, bob, clientId } = await setup();
    const secret = await newMatter(alice, clientId, { restricted: true });

    // Bob lacks user:manage and isn't the lead attorney, so he can't manage even a visible matter's access.
    const before = await alice.agent.get(`/v1/matters/${secret.id}/access`);
    expect(before.status).toBe(403); // alice is neither lead nor user manager
    await put(owner, `/v1/matters/${secret.id}/access`, {
      restricted: true,
      userIds: [alice.userId, bob.userId],
    }).expect(200);
    expect((await bob.agent.get(`/v1/matters/${secret.id}`)).status).toBe(200);
    expect(ids(await bob.agent.get('/v1/matters').expect(200))).toContain(secret.id);

    await put(owner, `/v1/matters/${secret.id}/access`, {
      restricted: true,
      userIds: [alice.userId],
    }).expect(200);
    expect((await bob.agent.get(`/v1/matters/${secret.id}`)).status).toBe(404);

    const audit = await owner.agent.get('/v1/audit-logs?action=matter.access_changed').expect(200);
    expect(audit.body.data.length).toBe(2);
    expect(audit.body.data[0].meta.removed).toContain(bob.userId);
  });

  it('lets the lead attorney manage access and keeps them on the list', async () => {
    const { owner, alice, bob, clientId } = await setup();
    const m = await newMatter(owner, clientId, { restricted: true, leadAttorneyId: alice.userId });
    expect((await alice.agent.get(`/v1/matters/${m.id}`).expect(200)).body.canManageAccess).toBe(
      true,
    );
    // Lead attorney was added automatically; she shares it, then tries to drop herself.
    const res = await put(alice, `/v1/matters/${m.id}/access`, {
      restricted: true,
      userIds: [bob.userId],
    }).expect(200);
    expect(res.body.userIds.sort()).toEqual([alice.userId, bob.userId].sort());
  });

  it('becomes visible to all again when the restriction is lifted', async () => {
    const { owner, alice, bob, clientId } = await setup();
    const m = await newMatter(owner, clientId, {
      restricted: true,
      accessUserIds: [alice.userId],
      leadAttorneyId: alice.userId,
    });
    expect((await bob.agent.get(`/v1/matters/${m.id}`)).status).toBe(404);
    await put(alice, `/v1/matters/${m.id}/access`, { restricted: false, userIds: [] }).expect(200);
    expect((await bob.agent.get(`/v1/matters/${m.id}`)).status).toBe(200);
    expect((await alice.agent.get(`/v1/matters/${m.id}/access`).expect(200)).body).toEqual({
      restricted: false,
      userIds: [],
    });
  });

  it('only accepts active members of the same organization on access lists', async () => {
    const { owner, clientId } = await setup();
    const other = await registerWithMfa(app, 'Other');
    const stranger = await addMember(app, other, 'attorney');
    const res = await post(owner, '/v1/matters', {
      clientId,
      title: 'Leaky Matter',
      practiceArea: 'tax',
      restricted: true,
      accessUserIds: [stranger.userId],
    });
    expect(res.status).toBe(400);
    const m = await newMatter(owner, clientId, { restricted: true });
    expect(
      (
        await put(owner, `/v1/matters/${m.id}/access`, {
          restricted: true,
          userIds: [stranger.userId],
        })
      ).status,
    ).toBe(400);
  });
});

describe('organization isolation (matters & parties)', () => {
  it('keeps matters, parties and counters separate between organizations', async () => {
    const a = await registerWithMfa(app, 'Alpha');
    const b = await registerWithMfa(app, 'Beta');
    const clientA = await newClient(a);
    const matterA = await newMatter(a, clientA, { title: 'Alpha Matter' });
    const party = (
      await post(a, `/v1/matters/${matterA.id}/parties`, {
        name: 'Alpha Party',
        type: 'individual',
        role: 'witness',
      }).expect(201)
    ).body;

    expect((await b.agent.get(`/v1/matters/${matterA.id}`)).status).toBe(404);
    expect((await patch(b, `/v1/matters/${matterA.id}`, { title: 'Hijacked Title' })).status).toBe(
      404,
    );
    expect((await b.agent.get(`/v1/matters/${matterA.id}/parties`)).status).toBe(404);
    expect(
      (await patch(b, `/v1/matters/${matterA.id}/parties/${party.id}`, { role: 'expert' })).status,
    ).toBe(404);
    expect((await del(b, `/v1/matters/${matterA.id}/parties/${party.id}`)).status).toBe(404);
    expect(
      (await put(b, `/v1/matters/${matterA.id}/access`, { restricted: true, userIds: [] })).status,
    ).toBe(404);
    expect((await b.agent.get('/v1/matters').expect(200)).body.data).toHaveLength(0);
    expect(
      (await b.agent.get(`/v1/matters?clientId=${clientA}`).expect(200)).body.data,
    ).toHaveLength(0);

    // Even Beta's owner can't use break-glass on Alpha's restricted matter.
    const secretA = await newMatter(a, clientA, { restricted: true });
    expect((await b.agent.get(`/v1/matters/${secretA.id}`)).status).toBe(404);
    expect(
      (await a.agent.get(`/v1/matters/${matterA.id}/parties`).expect(200)).body.data,
    ).toHaveLength(1);
  });
});
