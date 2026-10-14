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

const day = (n: number, hour = 9) => new Date(Date.UTC(2031, 0, 1 + n, hour)).toISOString();
const RANGE = `from=${encodeURIComponent(day(0, 0))}&to=${encodeURIComponent(day(60, 0))}`;
const ev = (extra: object = {}) => ({
  kind: 'meeting',
  title: 'Team sync',
  startsAt: day(1),
  ...extra,
});
const titles = (res: { body: { data: { title: string }[] } }) => res.body.data.map((e) => e.title);

describe('calendar events', () => {
  it('creates hearings and deadlines as manual entries and validates times', async () => {
    const owner = await registerWithMfa(app);
    const clientId = await newClient(owner);
    const matter = await newMatter(owner, clientId);
    const hearing = await post(
      owner,
      '/v1/calendar/events',
      ev({
        kind: 'hearing',
        title: 'Preliminary hearing',
        matterId: matter.id,
        endsAt: day(1, 11),
        location: 'Courtroom 4',
      }),
    );
    expect(hearing.status).toBe(201);
    expect(hearing.body).toMatchObject({
      kind: 'hearing',
      matterId: matter.id,
      source: 'manual',
      status: 'scheduled',
    });
    const deadline = await post(
      owner,
      '/v1/calendar/events',
      ev({ kind: 'deadline', title: 'File response', startsAt: day(10), allDay: true }),
    );
    expect(deadline.body.allDay).toBe(true);

    expect((await post(owner, '/v1/calendar/events', ev({ endsAt: day(0) }))).status).toBe(400); // ends before start
    expect(
      (await post(owner, '/v1/calendar/events', ev({ startsAt: 'next tuesday' }))).status,
    ).toBe(400);
    expect((await post(owner, '/v1/calendar/events', ev({ kind: 'party' }))).status).toBe(400);
  });

  it('lists a bounded date range in order, with cursor pagination and filters', async () => {
    const owner = await registerWithMfa(app);
    const clientId = await newClient(owner);
    const matter = await newMatter(owner, clientId);
    for (const [i, kind] of (
      ['meeting', 'deadline', 'hearing', 'deadline', 'reminder'] as const
    ).entries()) {
      await post(
        owner,
        '/v1/calendar/events',
        ev({
          kind,
          title: `Event ${i}`,
          startsAt: day(5 - i),
          ...(i % 2 ? { matterId: matter.id } : {}),
        }),
      ).expect(201);
    }
    // Two events share a start time: ordering must stay stable across pages.
    await post(owner, '/v1/calendar/events', ev({ title: 'Tie A', startsAt: day(20) })).expect(201);
    await post(owner, '/v1/calendar/events', ev({ title: 'Tie B', startsAt: day(20) })).expect(201);

    const all: string[] = [];
    let cursor = '';
    for (let page = 0; page < 5; page++) {
      const res = await owner.agent
        .get(`/v1/calendar/events?${RANGE}&limit=3${cursor}`)
        .expect(200);
      all.push(...titles(res));
      if (!res.body.page.nextCursor) break;
      cursor = `&cursor=${res.body.page.nextCursor}`;
    }
    expect(all).toEqual(['Event 4', 'Event 3', 'Event 2', 'Event 1', 'Event 0', 'Tie A', 'Tie B']);

    expect(
      titles(await owner.agent.get(`/v1/calendar/events?${RANGE}&kind=deadline`).expect(200)),
    ).toEqual(['Event 3', 'Event 1']);
    expect(
      titles(
        await owner.agent.get(`/v1/calendar/events?${RANGE}&matterId=${matter.id}`).expect(200),
      ),
    ).toEqual(['Event 3', 'Event 1']);
    // Half-open range: an event exactly at `to` is excluded.
    const edge = `from=${encodeURIComponent(day(0, 0))}&to=${encodeURIComponent(day(1, 9))}`;
    expect(titles(await owner.agent.get(`/v1/calendar/events?${edge}`).expect(200))).toEqual([]);
  });

  it('requires a bounded, sensible range', async () => {
    const owner = await registerWithMfa(app);
    expect((await owner.agent.get('/v1/calendar/events')).status).toBe(400);
    expect(
      (
        await owner.agent.get(
          `/v1/calendar/events?from=${encodeURIComponent(day(0))}&to=${encodeURIComponent(day(400))}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.agent.get(
          `/v1/calendar/events?from=${encodeURIComponent(day(5))}&to=${encodeURIComponent(day(1))}`,
        )
      ).status,
    ).toBe(400);
    expect((await owner.agent.get(`/v1/calendar/events?${RANGE}&cursor=garbage`)).status).toBe(400);
  });

  it('updates, completes and deletes events', async () => {
    const owner = await registerWithMfa(app);
    const e = (
      await post(owner, '/v1/calendar/events', ev({ kind: 'deadline', title: 'Old title' })).expect(
        201,
      )
    ).body;
    const updated = await patch(owner, `/v1/calendar/events/${e.id}`, {
      title: 'New title',
      status: 'completed',
    }).expect(200);
    expect(updated.body).toMatchObject({ title: 'New title', status: 'completed' });
    expect((await patch(owner, `/v1/calendar/events/${e.id}`, { endsAt: day(0) })).status).toBe(
      400,
    );
    expect((await patch(owner, `/v1/calendar/events/${e.id}`, {})).status).toBe(400);
    await del(owner, `/v1/calendar/events/${e.id}`).expect(204);
    expect((await owner.agent.get(`/v1/calendar/events/${e.id}`)).status).toBe(404);
  });

  it('enforces role permissions', async () => {
    const owner = await registerWithMfa(app);
    const staff = await addMember(app, owner, 'staff');
    const billing = await addMember(app, owner, 'billing');
    expect((await post(staff, '/v1/calendar/events', ev())).status).toBe(201);
    expect((await post(billing, '/v1/calendar/events', ev())).status).toBe(403);
    expect((await billing.agent.get(`/v1/calendar/events?${RANGE}`)).status).toBe(200);
  });
});

describe('calendar visibility', () => {
  async function setup() {
    const owner = await registerWithMfa(app);
    const alice = await addMember(app, owner, 'attorney');
    const bob = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const open = await newMatter(alice, clientId, { title: 'Open Matter' });
    const secret = await newMatter(alice, clientId, { title: 'Secret Matter', restricted: true });
    return { owner, alice, bob, open, secret };
  }

  it('hides events on restricted matters from users without access, but keeps org-level events', async () => {
    const { owner, alice, bob, open, secret } = await setup();
    await post(alice, '/v1/calendar/events', ev({ title: 'Firm lunch' })).expect(201);
    await post(
      alice,
      '/v1/calendar/events',
      ev({ title: 'Open hearing', kind: 'hearing', matterId: open.id }),
    ).expect(201);
    const hidden = (
      await post(
        alice,
        '/v1/calendar/events',
        ev({ title: 'Secret hearing', kind: 'hearing', matterId: secret.id }),
      ).expect(201)
    ).body;

    expect(
      titles(await alice.agent.get(`/v1/calendar/events?${RANGE}`).expect(200)).sort(),
    ).toEqual(['Firm lunch', 'Open hearing', 'Secret hearing']);
    expect(titles(await owner.agent.get(`/v1/calendar/events?${RANGE}`).expect(200))).toContain(
      'Secret hearing',
    );
    expect(titles(await bob.agent.get(`/v1/calendar/events?${RANGE}`).expect(200)).sort()).toEqual([
      'Firm lunch',
      'Open hearing',
    ]);

    expect((await bob.agent.get(`/v1/calendar/events?${RANGE}&matterId=${secret.id}`)).status).toBe(
      404,
    );
    const direct = await bob.agent.get(`/v1/calendar/events/${hidden.id}`);
    const missing = await bob.agent.get(`/v1/calendar/events/${'f'.repeat(24)}`);
    expect(direct.status).toBe(404);
    expect(direct.body.error.message).toBe(missing.body.error.message); // no existence leak
    expect(
      (await patch(bob, `/v1/calendar/events/${hidden.id}`, { title: 'Defaced' })).status,
    ).toBe(404);
    expect((await del(bob, `/v1/calendar/events/${hidden.id}`)).status).toBe(404);
    expect((await post(bob, '/v1/calendar/events', ev({ matterId: secret.id }))).status).toBe(404);
  });

  it('keeps attendees on restricted matters limited to people who can see them', async () => {
    const { owner, alice, bob, secret } = await setup();
    expect(
      (
        await post(
          alice,
          '/v1/calendar/events',
          ev({ matterId: secret.id, attendeeIds: [bob.userId] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          alice,
          '/v1/calendar/events',
          ev({ matterId: secret.id, attendeeIds: [owner.body.user.id] }),
        )
      ).status,
    ).toBe(201); // owner always has access
    await put(owner, `/v1/matters/${secret.id}/access`, {
      restricted: true,
      userIds: [alice.userId, bob.userId],
    }).expect(200);
    expect(
      (
        await post(
          alice,
          '/v1/calendar/events',
          ev({ matterId: secret.id, attendeeIds: [bob.userId] }),
        )
      ).status,
    ).toBe(201);
  });

  it('hides an event once it is moved onto a restricted matter', async () => {
    const { alice, bob, secret } = await setup();
    const e = (await post(alice, '/v1/calendar/events', ev({ title: 'Moves later' })).expect(201))
      .body;
    expect(titles(await bob.agent.get(`/v1/calendar/events?${RANGE}`).expect(200))).toContain(
      'Moves later',
    );
    await patch(alice, `/v1/calendar/events/${e.id}`, { matterId: secret.id }).expect(200);
    expect(titles(await bob.agent.get(`/v1/calendar/events?${RANGE}`).expect(200))).not.toContain(
      'Moves later',
    );
  });

  it('paginates correctly when hidden events are filtered out', async () => {
    const { alice, bob, secret } = await setup();
    for (let i = 0; i < 3; i++) {
      await post(
        alice,
        '/v1/calendar/events',
        ev({ title: `Visible ${i}`, startsAt: day(2 * i) }),
      ).expect(201);
      await post(
        alice,
        '/v1/calendar/events',
        ev({ title: `Hidden ${i}`, startsAt: day(2 * i + 1), matterId: secret.id }),
      ).expect(201);
    }
    const p1 = await bob.agent.get(`/v1/calendar/events?${RANGE}&limit=2`).expect(200);
    const p2 = await bob.agent
      .get(`/v1/calendar/events?${RANGE}&limit=2&cursor=${p1.body.page.nextCursor}`)
      .expect(200);
    expect([...titles(p1), ...titles(p2)]).toEqual(['Visible 0', 'Visible 1', 'Visible 2']);
    expect(p2.body.page.nextCursor).toBeNull();
  });
});

describe('calendar organization isolation', () => {
  it('never exposes or accepts another organization’s events, matters or attendees', async () => {
    const a = await registerWithMfa(app, 'Alpha');
    const b = await registerWithMfa(app, 'Beta');
    const bMember = await addMember(app, b, 'attorney');
    const matterA = await newMatter(a, await newClient(a));
    const eventA = (
      await post(
        a,
        '/v1/calendar/events',
        ev({ title: 'Alpha only', matterId: matterA.id }),
      ).expect(201)
    ).body;
    await post(a, '/v1/calendar/events', ev({ title: 'Alpha firm event' })).expect(201);

    expect(titles(await b.agent.get(`/v1/calendar/events?${RANGE}`).expect(200))).toEqual([]);
    expect((await b.agent.get(`/v1/calendar/events/${eventA.id}`)).status).toBe(404);
    expect((await patch(b, `/v1/calendar/events/${eventA.id}`, { title: 'Hijacked' })).status).toBe(
      404,
    );
    expect((await del(b, `/v1/calendar/events/${eventA.id}`)).status).toBe(404);
    expect((await post(b, '/v1/calendar/events', ev({ matterId: matterA.id }))).status).toBe(404);
    expect(
      (await post(a, '/v1/calendar/events', ev({ attendeeIds: [bMember.userId] }))).status,
    ).toBe(400);
    expect(titles(await a.agent.get(`/v1/calendar/events?${RANGE}`).expect(200)).sort()).toEqual([
      'Alpha firm event',
      'Alpha only',
    ]);
  });
});
