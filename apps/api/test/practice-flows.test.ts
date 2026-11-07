import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  addMember,
  bootApp,
  newClient,
  newMatter,
  portalUser,
  post,
  put,
  registerWithMfa,
} from './helpers';

describe('practice flows across billing, portal, and approvals', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp({
      MESSAGE_PROVIDER: 'mock',
      MESSAGE_WEBHOOK_SECRET: 'test-webhook-secret-16',
    });
  });
  afterAll(() => app.close());

  it('issues an INR invoice, records a manual payment, and hides it from someone without billing access', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const intern = await addMember(app, owner, 'intern');
    const clientId = await newClient(owner);
    const matter = await newMatter(owner, clientId, { title: 'Invoice matter' });
    await put(owner, `/v1/matters/${matter.id}/portal`, { visible: true }).expect(200);
    await post(owner, '/v1/tasks', {
      title: 'File the copies',
      matterId: matter.id,
      assigneeId: intern.userId,
    });
    const settings = await put(owner, '/v1/billing/settings', {
      currency: 'INR',
      defaultHourlyRateCents: 100000,
      defaultTaxRateBp: 0,
      invoiceDueDays: 15,
    });
    expect(settings.status).toBe(200);
    const read = await owner.agent.get('/v1/billing/settings');
    expect(read.body).toMatchObject({
      currency: 'INR',
      policy: { tax: 'explicit_rate_only', collection: 'manual_only', gst: 'not_determined' },
    });
    const draft = await post(owner, '/v1/invoices', {
      clientId,
      matterIds: [matter.id],
      taxRateBp: 0,
    });
    expect(draft.status).toBe(201);
    expect(draft.body.currency).toBe('INR');
    const line = await post(owner, `/v1/invoices/${draft.body.id}/lines`, {
      type: 'expense',
      description: 'Court fee typed by the firm',
      amountCents: 150000,
      matterId: matter.id,
    });
    expect(line.status).toBe(201);
    expect(line.body.totalCents).toBe(150000);
    const issued = await post(owner, `/v1/invoices/${draft.body.id}/issue`, {});
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({ status: 'issued', currency: 'INR', balanceCents: 150000 });
    expect(
      (
        await post(attorney, `/v1/invoices/${draft.body.id}/payments`, {
          amountCents: 150000,
          method: 'bank_transfer',
          reference: 'NEFT typed by the firm',
        })
      ).status,
    ).toBe(403);
    expect((await intern.agent.get('/v1/invoices')).status).toBe(403);
    const paid = await owner.agent
      .post(`/v1/invoices/${draft.body.id}/payments`)
      .set('x-csrf-token', owner.csrf)
      .set('idempotency-key', 'inr-payment-0001')
      .send({ amountCents: 150000, method: 'bank_transfer', reference: 'NEFT typed by the firm' });
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({ status: 'paid', currency: 'INR', balanceCents: 0 });

    const portal = await portalUser(app, owner, owner.body.organization.slug, clientId);
    const visible = await portal.agent.get(`/v1/portal/matters/${matter.id}/invoices`);
    expect(visible.status).toBe(200);
    expect(visible.body.data).toEqual([
      expect.objectContaining({
        number: issued.body.number,
        status: 'paid',
        currency: 'INR',
        totalCents: 150000,
        balanceCents: 0,
      }),
    ]);
    expect(JSON.stringify(visible.body)).not.toMatch(/Court fee|NEFT/);
    const other = await newClient(owner);
    const stranger = await portalUser(app, owner, owner.body.organization.slug, other);
    expect((await stranger.agent.get(`/v1/portal/matters/${matter.id}/invoices`)).status).toBe(404);
  });

  it('shows a released message to the assigned client and refuses an unauthorised approval', async () => {
    const owner = await registerWithMfa(app);
    const admin = await addMember(app, owner, 'admin');
    const attorney = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const otherId = await newClient(owner);
    const matter = await newMatter(owner, clientId);
    const otherMatter = await newMatter(owner, otherId);
    await put(owner, `/v1/matters/${matter.id}/portal`, { visible: true }).expect(200);
    await put(owner, `/v1/matters/${otherMatter.id}/portal`, { visible: true }).expect(200);
    const drafted = await post(attorney, '/v1/outbox', {
      clientId,
      matterId: matter.id,
      channel: 'email',
      templateLabel: 'Hearing note',
      body: 'The next date was typed from the brief.',
      consent: {
        optedIn: true,
        namesFirm: true,
        note: 'The client asked the firm for email updates.',
      },
    });
    expect(drafted.status).toBe(201);
    expect((await post(admin, `/v1/outbox/${drafted.body.id}/approve`, {})).status).toBe(403);
    expect(
      (await request(app.getHttpServer()).post(`/v1/outbox/${drafted.body.id}/approve`).send({}))
        .status,
    ).toBe(401);
    const portal = await portalUser(app, owner, owner.body.organization.slug, clientId);
    const before = await portal.agent.get(`/v1/portal/matters/${matter.id}/messages`);
    expect(before.body.data).toEqual([]);
    const approved = await post(attorney, `/v1/outbox/${drafted.body.id}/approve`, {});
    expect(approved.body.status).toBe('mock_delivered');
    const after = await portal.agent.get(`/v1/portal/matters/${matter.id}/messages`);
    expect(after.body.data).toEqual([
      expect.objectContaining({
        body: 'The next date was typed from the brief.',
        status: 'mock_delivered',
      }),
    ]);
    const stranger = await portalUser(app, owner, owner.body.organization.slug, otherId);
    expect((await stranger.agent.get(`/v1/portal/matters/${matter.id}/messages`)).status).toBe(404);
    expect(
      (await stranger.agent.get(`/v1/portal/matters/${otherMatter.id}/messages`)).body.data,
    ).toEqual([]);

    const opted = await post(owner, `/v1/clients/${clientId}/whatsapp-opt-out`, { optedOut: true });
    expect(opted.status).toBe(201);
    const blocked = await post(attorney, '/v1/outbox', {
      clientId,
      matterId: matter.id,
      channel: 'whatsapp',
      templateLabel: 'Second note',
      body: 'This must not be delivered after an opt-out.',
      consent: { optedIn: true, namesFirm: true },
    });
    const refused = await post(attorney, `/v1/outbox/${blocked.body.id}/approve`, {});
    expect(refused.status).toBe(409);
  });
});
