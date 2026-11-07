import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bootApp,
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

type Entry = {
  type: string;
  title: string;
  detail: string | null;
  at: string;
  matterId: string | null;
};
const types = (body: { data: Entry[] }) => body.data.map((e) => e.type);

describe('matter and client timelines', () => {
  it('shows what happened on a matter, newest first, without exposing internals', async () => {
    const o = await registerWithMfa(app);
    const clientId = await newClient(o);
    const m = await newMatter(o, clientId, { title: 'Lease Dispute' });
    await post(o, `/v1/matters/${m.id}/parties`, {
      name: 'Landlord LLC',
      type: 'organization',
      role: 'opposing_party',
    });
    const task = await post(o, '/v1/tasks', { title: 'File motion', matterId: m.id });
    await patch(o, `/v1/tasks/${task.body.id}`, { status: 'done' });
    await post(o, '/v1/calendar/events', {
      kind: 'hearing',
      title: 'First hearing',
      matterId: m.id,
      startsAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    const res = await o.agent.get(`/v1/matters/${m.id}/timeline`).expect(200);
    expect(types(res.body)).toEqual(
      expect.arrayContaining([
        'matter.opened',
        'party.added',
        'task.created',
        'task.completed',
        'event.hearing',
      ]),
    );
    const times = res.body.data.map((e: Entry) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times); // newest first
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|storageKey|tokenHash/);
    expect(res.body.page.nextBefore).toBeNull();
  });

  it('pages with a `before` cursor and rejects bad input', async () => {
    const o = await registerWithMfa(app);
    const m = await newMatter(o, await newClient(o));
    for (let i = 0; i < 4; i++) await post(o, '/v1/tasks', { title: `Task ${i}`, matterId: m.id });
    const first = (await o.agent.get(`/v1/matters/${m.id}/timeline?limit=3`).expect(200)).body;
    expect(first.data).toHaveLength(3);
    expect(first.page.nextBefore).toBeTruthy();
    const second = (
      await o.agent
        .get(
          `/v1/matters/${m.id}/timeline?limit=3&before=${encodeURIComponent(first.page.nextBefore)}`,
        )
        .expect(200)
    ).body;
    expect(second.data.length).toBeGreaterThan(0);
    const seen = new Set(first.data.map((e: Entry) => `${e.type}|${e.detail}|${e.at}`));
    for (const e of second.data) expect(seen.has(`${e.type}|${e.detail}|${e.at}`)).toBe(false);
    await o.agent.get(`/v1/matters/${m.id}/timeline?before=yesterday`).expect(400);
    await o.agent.get(`/v1/matters/${m.id}/timeline?limit=1000`).expect(400);
  });

  it('combines every visible matter of a client, but never a restricted one the viewer cannot see', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const open = await newMatter(owner, clientId, { title: 'Open matter' });
    const secret = await newMatter(owner, clientId, { title: 'Secret matter', restricted: true });
    await post(owner, '/v1/tasks', { title: 'Secret task', matterId: secret.id });
    await post(owner, '/v1/tasks', { title: 'Open task', matterId: open.id });

    const mine = (await attorney.agent.get(`/v1/clients/${clientId}/timeline`).expect(200)).body;
    const text = JSON.stringify(mine);
    expect(text).toContain('Open task');
    expect(text).not.toMatch(/Secret/);
    const all = JSON.stringify(
      (await owner.agent.get(`/v1/clients/${clientId}/timeline`).expect(200)).body,
    );
    expect(all).toMatch(/Secret task/);

    // The restricted matter's own timeline is a 404 for someone without access, like any other hidden matter.
    await attorney.agent.get(`/v1/matters/${secret.id}/timeline`).expect(404);
  });

  it('hides an invoice that also touches a restricted matter', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const open = await newMatter(owner, clientId, { title: 'Open matter' });
    const secret = await newMatter(owner, clientId, { title: 'Secret matter', restricted: true });
    await put(owner, '/v1/billing/settings', {
      currency: 'USD',
      defaultHourlyRateCents: 20000,
      defaultTaxRateBp: 0,
      invoiceDueDays: 30,
    });
    for (const matterId of [open.id, secret.id])
      await post(owner, '/v1/time-entries', {
        matterId,
        workDate: new Date().toISOString().slice(0, 10),
        minutes: 60,
        description: 'Work on the matter',
      });
    const inv = await post(owner, '/v1/invoices', { clientId, matterIds: [open.id, secret.id] });
    expect(inv.status).toBe(201);
    const issued = await post(owner, `/v1/invoices/${inv.body.id}/issue`, {});
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);

    expect(types((await owner.agent.get(`/v1/clients/${clientId}/timeline`)).body)).toContain(
      'invoice.issued',
    );
    expect(
      types((await attorney.agent.get(`/v1/clients/${clientId}/timeline`)).body),
    ).not.toContain('invoice.issued');
  });

  it('is scoped to the organization and to client:read', async () => {
    const a = await registerWithMfa(app, 'Alpha');
    const b = await registerWithMfa(app, 'Beta');
    const clientId = await newClient(a);
    const m = await newMatter(a, clientId);
    await b.agent.get(`/v1/clients/${clientId}/timeline`).expect(404);
    await b.agent.get(`/v1/matters/${m.id}/timeline`).expect(404);
    const billing = await addMember(app, a, 'billing');
    await billing.agent.get(`/v1/matters/${m.id}/timeline`).expect(200);
  });
});
