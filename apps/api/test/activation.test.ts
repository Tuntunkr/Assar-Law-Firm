import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  addMember,
  bootApp,
  createServiceToken,
  newClient,
  post,
  registerWithMfa,
} from './helpers';

const row = (externalId: string, title: string, retrievedAt: string) => ({
  externalId,
  courtName: 'Synthetic Court',
  caseNumber: 'SYN/1/2026',
  title,
  listedOn: '2026-12-01',
  sourceName: 'Firm file',
  sourceUrl: 'https://example.com/synthetic-cause-list',
  retrievedAt,
});

describe('local activation, court import off by default', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(() => app.close());

  it('does not store a booking or a court row when the switches are off', async () => {
    const owner = await registerWithMfa(app);
    expect((await request(app.getHttpServer()).post('/v1/demo-bookings').send({})).status).toBe(400);
    expect((await request(app.getHttpServer()).get('/v1/demo-bookings/slots')).status).toBe(503);
    const blocked = await post(owner, '/v1/courts/imports', {
      rows: [row('SYN-OFF', 'Not stored', new Date().toISOString())],
    });
    expect(blocked.status).toBe(503);
    const feed = await owner.agent.get('/v1/courts/feed');
    expect(feed.body).toMatchObject({ mode: 'manual', lookup: 'not_performed' });
  });
});

describe('local activation when the switches are on', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp({
      COURT_FEED: 'import',
      EMAIL_DELIVERY: 'local',
      DEMO_BOOKING: 'local',
    });
  });
  afterAll(() => app.close());

  it('stores an imported row once, rejects a silent overwrite, and keeps a stale row off any matter', async () => {
    const owner = await registerWithMfa(app);
    const fresh = new Date().toISOString();
    const first = await post(owner, '/v1/courts/imports', {
      rows: [row('SYN-1', 'Synthetic listing', fresh)],
    });
    expect(first.status).toBe(201);
    expect(first.body.appliedToMatter).toBe(false);
    expect(first.body.results[0].outcome).toBe('stored');
    const again = await post(owner, '/v1/courts/imports', {
      rows: [row('SYN-1', 'Synthetic listing', fresh)],
    });
    expect(again.body.results[0].outcome).toBe('replayed');
    const changed = await post(owner, '/v1/courts/imports', {
      rows: [row('SYN-1', 'Different title', fresh)],
    });
    expect(changed.body.results[0].outcome).toBe('conflict');
    const stale = await post(owner, '/v1/courts/imports', {
      rows: [row('SYN-OLD', 'Old listing', '2020-01-01T00:00:00.000Z')],
    });
    expect(stale.body.results[0].outcome).toBe('stale');
    const operator = row('SYN-1', 'Different title', fresh) as Record<string, unknown>;
    operator.externalId = { $gt: '' };
    expect((await post(owner, '/v1/courts/imports', { rows: [operator] })).status).toBe(400);
  });

  it('keeps an approved email on this machine', async () => {
    const owner = await registerWithMfa(app);
    const clientId = await newClient(owner, 'Synthetic Holdings');
    await owner.agent
      .patch(`/v1/clients/${clientId}`)
      .set('x-csrf-token', owner.csrf)
      .send({ email: 'desk@example.test' })
      .expect(200);
    const draft = await post(owner, '/v1/outbox', {
      clientId,
      channel: 'email',
      templateLabel: 'Synthetic preview',
      body: 'This message stays on this computer.',
      consent: { optedIn: true, namesFirm: true, note: 'Synthetic opt-in' },
    }).expect(201);
    const approved = await post(owner, `/v1/outbox/${draft.body.id}/approve`, {}).expect(201);
    expect(approved.body).toMatchObject({ status: 'held_local', provider: 'local_mailbox' });
    const box = await owner.agent.get('/v1/mailbox').expect(200);
    expect(box.body.data[0]).toMatchObject({ to: 'desk@example.test', status: 'held_local' });
  });

  it('lets an attorney sign a draft and refuses everyone else, including a service token', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const paralegal = await addMember(app, owner, 'paralegal');
    const draft = await post(paralegal, '/v1/court-forms', {
      title: 'Synthetic draft form',
      body: 'This is a draft. It is not a court filing.',
      officialSourceTitle: 'Unverified sample',
      officialSourceUrl: 'https://example.com/synthetic-form',
      sourceRetrievedOn: '2026-11-01',
    }).expect(201);
    expect(draft.body).toMatchObject({
      status: 'draft',
      jurisdiction: 'unknown',
      licenseCheck: 'not_performed',
    });
    expect(
      (
        await post(paralegal, `/v1/court-forms/${draft.body.id}/signoff`, {
          decision: 'legally_approved',
          advocateDeclaration: true,
          note: 'I am a licensed advocate. This note is a test.',
        })
      ).status,
    ).toBe(403);
    const token = await createServiceToken(owner, ['matters:read']);
    expect(
      (
        await request(app.getHttpServer())
          .post(`/v1/court-forms/${draft.body.id}/signoff`)
          .set('authorization', `Bearer ${token.token}`)
          .send({
            decision: 'legally_approved',
            advocateDeclaration: true,
            note: 'A service token must not sign this.',
          })
      ).status,
    ).toBe(401);
    const signed = await post(attorney, `/v1/court-forms/${draft.body.id}/signoff`, {
      decision: 'legally_approved',
      advocateDeclaration: true,
      note: 'Signed for this synthetic draft only. The software did not check a roll.',
    }).expect(200);
    expect(signed.body).toMatchObject({ status: 'legally_approved', licenseCheck: 'not_performed' });
  });

  it('records one local demo slot and does not send a notification', async () => {
    const slots = await request(app.getHttpServer()).get('/v1/demo-bookings/slots').expect(200);
    const slotStart = slots.body.slots[0] as string;
    const body = {
      name: 'Preview Person',
      email: 'preview.person@example.test',
      firm: 'Synthetic Preview LLP',
      firmSize: '1-5',
      consent: true,
      slotStart,
    };
    const saved = await request(app.getHttpServer()).post('/v1/demo-bookings').send(body).expect(201);
    expect(saved.body).toMatchObject({ status: 'recorded_local', notification: 'not_sent' });
    expect((await request(app.getHttpServer()).post('/v1/demo-bookings').send(body)).status).toBe(409);
  });

  it('refuses to issue a taxed invoice until an accountant review is recorded', async () => {
    const owner = await registerWithMfa(app);
    const clientId = await newClient(owner);
    const draft = await post(owner, '/v1/invoices', { clientId, taxRateBp: 1800 }).expect(201);
    await post(owner, `/v1/invoices/${draft.body.id}/lines`, {
      type: 'expense',
      description: 'Synthetic retainer',
      amountCents: 100000,
    }).expect(201);
    const blocked = await post(owner, `/v1/invoices/${draft.body.id}/issue`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/accountant/i);
    await post(owner, `/v1/invoices/${draft.body.id}/accountant-review`, {}).expect(200);
    const issued = await post(owner, `/v1/invoices/${draft.body.id}/issue`, {}).expect(200);
    expect(issued.body.status).toBe('issued');
    expect(issued.body.accountantReviewedAt).toEqual(expect.any(String));
  });
});

describe('smtp delivery stays closed', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp({ EMAIL_DELIVERY: 'smtp' });
  });
  afterAll(() => app.close());

  it('does not open a mail connection', async () => {
    const owner = await registerWithMfa(app);
    const clientId = await newClient(owner);
    await owner.agent
      .patch(`/v1/clients/${clientId}`)
      .set('x-csrf-token', owner.csrf)
      .send({ email: 'desk@example.test' })
      .expect(200);
    const draft = await post(owner, '/v1/outbox', {
      clientId,
      channel: 'email',
      templateLabel: 'Do not send',
      body: 'This must stay unsent.',
      consent: { optedIn: true, namesFirm: true },
    }).expect(201);
    const approved = await post(owner, `/v1/outbox/${draft.body.id}/approve`, {}).expect(201);
    expect(approved.body).toMatchObject({
      status: 'external_activation_gate',
      provider: 'smtp',
      providerError: 'smtp_send_not_enabled',
    });
  });
});
