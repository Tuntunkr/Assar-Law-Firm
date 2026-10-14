import type { INestApplication } from '@nestjs/common';
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

describe('clients', () => {
  it('lets permitted roles write and everyone with client:read read', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const staff = await addMember(app, owner, 'staff');
    const billing = await addMember(app, owner, 'billing');

    const id = await newClient(attorney, 'Jane Q. Public');
    expect((await staff.agent.get(`/v1/clients/${id}`)).status).toBe(200);
    expect((await billing.agent.get(`/v1/clients/${id}`)).status).toBe(200);
    expect(
      (await post(staff, '/v1/clients', { type: 'individual', name: 'Nope Nope' })).status,
    ).toBe(403);
    expect((await patch(billing, `/v1/clients/${id}`, { name: 'Changed Name' })).status).toBe(403);
  });

  it('validates input and returns the error envelope', async () => {
    const owner = await registerWithMfa(app);
    const res = await post(owner, '/v1/clients', {
      type: 'martian',
      name: 'x',
      email: 'not-an-email',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'email',
      'name',
      'type',
    ]);
    expect((await owner.agent.get('/v1/clients/not-an-id')).status).toBe(404);
  });

  it('paginates, searches by name prefix (accent/case-insensitive) and filters by status', async () => {
    const owner = await registerWithMfa(app);
    const ids = [] as string[];
    for (const n of ['Álvaro Pérez', 'Beta Industries', 'Alpine Legal Co'])
      ids.push(await newClient(owner, n));

    const p1 = await owner.agent.get('/v1/clients?limit=2').expect(200);
    expect(p1.body.data).toHaveLength(2);
    const p2 = await owner.agent
      .get(`/v1/clients?limit=2&cursor=${p1.body.page.nextCursor}`)
      .expect(200);
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.page.nextCursor).toBeNull();

    const q = await owner.agent.get('/v1/clients?q=ALV').expect(200);
    expect(q.body.data.map((c: { name: string }) => c.name)).toEqual(['Álvaro Pérez']);
    expect((await owner.agent.get('/v1/clients?q=.*').expect(200)).body.data).toHaveLength(0); // regex chars are literal

    await patch(owner, `/v1/clients/${ids[1]}`, { status: 'archived' }).expect(200);
    const archived = await owner.agent.get('/v1/clients?status=archived').expect(200);
    expect(archived.body.data.map((c: { id: string }) => c.id)).toEqual([ids[1]]);
  });

  it('audits changes by field name only, never by value', async () => {
    const owner = await registerWithMfa(app);
    const id = await newClient(owner, 'Privacy Test Client');
    await patch(owner, `/v1/clients/${id}`, { email: 'secret.person@example.test' }).expect(200);
    const logs = await owner.agent.get('/v1/audit-logs?action=client.updated').expect(200);
    expect(logs.body.data[0].meta).toEqual({ fields: ['email'] });
    expect(JSON.stringify(logs.body)).not.toContain('secret.person');
  });

  it('is idempotent when an Idempotency-Key is supplied, and works without one', async () => {
    const owner = await registerWithMfa(app);
    const key = idemKey();
    const send = () =>
      owner.agent
        .post('/v1/clients')
        .set('x-csrf-token', owner.csrf)
        .set('idempotency-key', key)
        .send({ type: 'individual', name: 'Once Only' });
    const first = await send().expect(201);
    const second = await send().expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect((await owner.agent.get('/v1/clients?q=once').expect(200)).body.data).toHaveLength(1);
    await post(owner, '/v1/clients', { type: 'individual', name: 'No Key Needed' }).expect(201);
  });
});

describe('teams', () => {
  it('manages teams with validated members', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const paralegal = await addMember(app, owner, 'paralegal');

    const created = await post(owner, '/v1/teams', {
      name: 'Litigation',
      description: 'Court work',
      userIds: [attorney.userId],
    }).expect(201);
    const id = created.body.id;
    expect(created.body.userIds).toEqual([attorney.userId]);

    const updated = await put(owner, `/v1/teams/${id}/members`, {
      userIds: [attorney.userId, paralegal.userId, paralegal.userId],
    }).expect(200);
    expect(updated.body.userIds.sort()).toEqual([attorney.userId, paralegal.userId].sort()); // de-duplicated

    expect((await post(owner, '/v1/teams', { name: 'litigation' })).status).toBe(409); // names unique, case-insensitive
    expect(
      (await put(owner, `/v1/teams/${id}/members`, { userIds: ['a'.repeat(24)] })).status,
    ).toBe(400);

    // Everyone with matter:read can list; only user managers can change.
    expect((await attorney.agent.get('/v1/teams')).body.data).toHaveLength(1);
    expect((await post(attorney, '/v1/teams', { name: 'Rogue' })).status).toBe(403);
    expect((await put(attorney, `/v1/teams/${id}/members`, { userIds: [] })).status).toBe(403);
  });

  it('rejects disabled users and removes a deleted team from matters', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const team = (await post(owner, '/v1/teams', { name: 'Corporate' }).expect(201)).body.id;
    const clientId = await newClient(owner);
    const matter = await newMatter(owner, clientId, { teamIds: [team] });

    await patch(owner, `/v1/organization/members/${attorney.userId}`, {
      status: 'disabled',
    }).expect(200);
    expect(
      (await put(owner, `/v1/teams/${team}/members`, { userIds: [attorney.userId] })).status,
    ).toBe(400);

    await del(owner, `/v1/teams/${team}`).expect(204);
    expect((await owner.agent.get(`/v1/matters/${matter.id}`).expect(200)).body.teamIds).toEqual(
      [],
    );
    expect((await owner.agent.get(`/v1/teams/${team}`)).status).toBe(404);
  });
});

describe('organization isolation (clients & teams)', () => {
  it('never reveals or lets one organization modify another’s records', async () => {
    const a = await registerWithMfa(app, 'Alpha');
    const b = await registerWithMfa(app, 'Beta');
    const aMember = await addMember(app, a, 'attorney');
    const clientA = await newClient(a, 'Alpha Private Client');
    const teamA = (await post(a, '/v1/teams', { name: 'Alpha Team' }).expect(201)).body.id;

    expect((await b.agent.get(`/v1/clients/${clientA}`)).status).toBe(404);
    expect((await patch(b, `/v1/clients/${clientA}`, { name: 'Hijacked Name' })).status).toBe(404);
    expect((await b.agent.get('/v1/clients').expect(200)).body.data).toHaveLength(0);
    expect((await b.agent.get('/v1/clients?q=alpha').expect(200)).body.data).toHaveLength(0);

    expect((await b.agent.get(`/v1/teams/${teamA}`)).status).toBe(404);
    expect((await del(b, `/v1/teams/${teamA}`)).status).toBe(404);
    expect((await put(b, `/v1/teams/${teamA}/members`, { userIds: [] })).status).toBe(404);
    expect((await b.agent.get('/v1/teams').expect(200)).body.data).toHaveLength(0);

    // Foreign ids can't be smuggled in as members or team references.
    const teamB = (await post(b, '/v1/teams', { name: 'Beta Team' }).expect(201)).body.id;
    expect((await put(b, `/v1/teams/${teamB}/members`, { userIds: [aMember.userId] })).status).toBe(
      400,
    );
    const clientB = await newClient(b, 'Beta Client');
    expect(
      (
        await post(b, '/v1/matters', {
          clientId: clientB,
          title: 'Beta Matter',
          practiceArea: 'tax',
          teamIds: [teamA],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(b, '/v1/matters', {
          clientId: clientA,
          title: 'Beta Matter',
          practiceArea: 'tax',
        })
      ).status,
    ).toBe(404);

    // A's data is intact.
    expect((await a.agent.get(`/v1/clients/${clientA}`).expect(200)).body.name).toBe(
      'Alpha Private Client',
    );
  });
});
