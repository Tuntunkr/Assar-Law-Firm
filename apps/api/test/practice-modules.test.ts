import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { istDate } from '@assar/types';
import { hmac } from '../src/common/crypto';
import { addMember, bootApp, newClient, newMatter, post, registerWithMfa } from './helpers';

const SECRET = 'test-webhook-secret-16';

describe('approved practice modules', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp({
      MESSAGE_PROVIDER: 'mock',
      MESSAGE_WEBHOOK_SECRET: SECRET,
    });
  });
  afterAll(() => app.close());

  it('keeps court tracking manual and refuses a fake feed', async () => {
    const owner = await registerWithMfa(app);
    const provider = await owner.agent.get('/v1/courts/provider');
    expect(provider.status).toBe(200);
    expect(provider.body).toMatchObject({
      status: 'external_activation_gate',
      lookup: 'not_performed',
    });
    const clientId = await newClient(owner);
    const bad = await post(owner, '/v1/matters', {
      clientId,
      title: 'Bad CNR',
      practiceArea: 'litigation',
      court: { cnr: 'NOPE', officialUrl: 'http://insecure.example/case' },
    });
    expect(bad.status).toBe(400);
    const created = await post(owner, '/v1/matters', {
      clientId,
      title: 'Tracked matter',
      practiceArea: 'litigation',
      court: {
        name: 'District court',
        cnr: 'DLHC010012342026',
        officialUrl: 'https://example.org/official-record',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.court).toMatchObject({
      cnr: 'DLHC010012342026',
      trackingSource: 'manual',
      freshness: 'unverified',
      lookup: 'not_performed',
    });
    const verified = await post(owner, `/v1/matters/${created.body.id}/court/verify`, {});
    expect(verified.status).toBe(201);
    expect(verified.body.court.freshness).toBe('verified_manual');
    expect(verified.body.court.stale).toBe(false);
  });

  it('isolates an intern to an assigned matter and their own tasks', async () => {
    const owner = await registerWithMfa(app);
    const intern = await addMember(app, owner, 'intern');
    const clientId = await newClient(owner);
    const visible = await newMatter(owner, clientId, { title: 'Assigned' });
    const hidden = await newMatter(owner, clientId, { title: 'Other' });
    expect((await intern.agent.get('/v1/matters')).body.data).toEqual([]);
    expect((await intern.agent.get(`/v1/matters/${hidden.id}`)).status).toBe(404);
    const task = await post(owner, '/v1/tasks', {
      title: 'Index the file',
      matterId: visible.id,
      assigneeId: intern.userId,
    });
    expect(task.status).toBe(201);
    expect((await intern.agent.get(`/v1/matters/${visible.id}`)).status).toBe(200);
    expect((await intern.agent.get(`/v1/matters/${hidden.id}`)).status).toBe(404);
    expect(
      (await intern.agent.get('/v1/tasks')).body.data.map((t: { id: string }) => t.id),
    ).toEqual([task.body.id]);
    const status = await intern.agent
      .patch(`/v1/tasks/${task.body.id}`)
      .set('x-csrf-token', intern.csrf)
      .send({ status: 'in_progress' });
    expect(status.status).toBe(200);
    const blocked = await intern.agent
      .patch(`/v1/tasks/${task.body.id}`)
      .set('x-csrf-token', intern.csrf)
      .send({ title: 'Take over the matter' });
    expect(blocked.status).toBe(403);
  });

  it('requires a lawyer to review a hearing outcome and to approve a typed date', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const paralegal = await addMember(app, owner, 'paralegal');
    const intern = await addMember(app, owner, 'intern');
    const clientId = await newClient(owner);
    const matter = await newMatter(owner, clientId);
    await post(owner, '/v1/tasks', {
      title: 'Carry papers',
      matterId: matter.id,
      assigneeId: intern.userId,
    });
    const hearing = await post(owner, '/v1/calendar/events', {
      kind: 'hearing',
      title: 'First hearing',
      matterId: matter.id,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const draft = await post(paralegal, `/v1/calendar/events/${hearing.body.id}/outcome`, {
      result: 'adjourned',
      notes: 'The board wrote the next date on the brief. Typed here, not calculated.',
      nextHearingOn: '2026-12-01',
    });
    expect(draft.status).toBe(201);
    expect(draft.body.outcome.reviewStatus).toBe('draft');
    expect(
      (await post(paralegal, `/v1/calendar/events/${hearing.body.id}/outcome/review`, {})).status,
    ).toBe(403);
    const reviewed = await post(
      attorney,
      `/v1/calendar/events/${hearing.body.id}/outcome/review`,
      {},
    );
    expect(reviewed.status).toBe(201);
    expect(reviewed.body.outcome.reviewStatus).toBe('reviewed');
    const next = await post(attorney, `/v1/calendar/events/${hearing.body.id}/schedule-next`, {});
    expect(next.status).toBe(201);
    expect(next.body.source).toBe('manual');
    expect(next.body.kind).toBe('hearing');

    const deadline = await post(paralegal, '/v1/deadlines', {
      matterId: matter.id,
      kind: 'limitation',
      title: 'Typed outer date',
      basisNote: 'Counsel typed this date from the brief. The software did not apply a statute.',
      dueOn: istDate(),
    });
    expect(deadline.status).toBe(201);
    expect(deadline.body.statutoryCalculation).toBe('not_performed');
    expect(deadline.body.timezone).toBe('Asia/Kolkata');
    expect((await post(intern, `/v1/deadlines/${deadline.body.id}/approve`, {})).status).toBe(403);
    expect((await post(paralegal, `/v1/deadlines/${deadline.body.id}/approve`, {})).status).toBe(
      403,
    );
    const submitted = await post(paralegal, `/v1/deadlines/${deadline.body.id}/submit`, {});
    expect(submitted.body.status).toBe('pending_approval');
    const approved = await post(attorney, `/v1/deadlines/${deadline.body.id}/approve`, {});
    expect(approved.body.status).toBe('approved');
    const run = await post(attorney, '/v1/deadlines/reminders/run', {});
    expect(run.status).toBe(201);
    expect(run.body.notified).toBeGreaterThan(0);
  });

  it('approves a message preview in mock mode and acknowledges it once', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const paralegal = await addMember(app, owner, 'paralegal');
    const clientId = await newClient(owner);
    const matter = await newMatter(owner, clientId);
    const missing = await post(paralegal, '/v1/outbox', {
      clientId,
      matterId: matter.id,
      channel: 'whatsapp',
      templateLabel: 'Hearing note',
      body: 'The hearing was adjourned. This is a preview.',
    });
    expect(missing.status).toBe(400);
    const drafted = await post(paralegal, '/v1/outbox', {
      clientId,
      matterId: matter.id,
      channel: 'whatsapp',
      templateLabel: 'Hearing note',
      body: 'The hearing was adjourned. This preview names the firm in the opt-in note.',
      consent: {
        optedIn: true,
        namesFirm: true,
        note: 'Client asked for WhatsApp updates from the firm.',
      },
    });
    expect(drafted.status).toBe(201);
    expect(drafted.body.providerTemplateApproval).toBe('not_claimed');
    expect(drafted.body.status).toBe('pending_approval');
    const approved = await post(attorney, `/v1/outbox/${drafted.body.id}/approve`, {});
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('mock_delivered');
    expect(approved.body.provider).toBe('mock');

    const payload = {
      eventId: 'event-ack-0001',
      outboxId: drafted.body.id as string,
      status: 'mock_ack' as const,
    };
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `sha256=${hmac(SECRET, `${timestamp}.${raw}`)}`;
    const call = () =>
      request(app.getHttpServer())
        .post('/v1/webhooks/messages/mock')
        .set('content-type', 'application/json')
        .set('x-assar-timestamp', timestamp)
        .set('x-assar-signature', signature)
        .set('x-assar-organization', owner.body.organization.id)
        .send(raw);
    expect((await call()).status).toBe(200);
    expect((await call()).body.replayed).toBe(true);
    const bad = await request(app.getHttpServer())
      .post('/v1/webhooks/messages/mock')
      .set('content-type', 'application/json')
      .set('x-assar-timestamp', timestamp)
      .set('x-assar-signature', 'sha256=nope')
      .set('x-assar-organization', owner.body.organization.id)
      .send(raw);
    expect(bad.status).toBe(401);
  });

  it('saves INR without inventing a tax rate', async () => {
    const owner = await registerWithMfa(app);
    const saved = await owner.agent
      .put('/v1/billing/settings')
      .set('x-csrf-token', owner.csrf)
      .send({
        currency: 'INR',
        defaultHourlyRateCents: 500000,
        defaultTaxRateBp: 0,
        invoiceDueDays: 15,
        reminderDays: [7, 1],
      });
    expect(saved.status).toBe(200);
    const settings = await owner.agent.get('/v1/billing/settings');
    expect(settings.body).toMatchObject({
      currency: 'INR',
      defaultTaxRateBp: 0,
      policy: { tax: 'explicit_rate_only', collection: 'manual_only', gst: 'not_determined' },
    });
  });
});
