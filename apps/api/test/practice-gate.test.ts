import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { addMember, bootApp, newClient, newMatter, post, registerWithMfa } from './helpers';

describe('message provider stays gated without credentials', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(() => app.close());

  it('records lawyer approval and does not mark the preview sent', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const matter = await newMatter(owner, clientId);
    const drafted = await post(owner, '/v1/outbox', {
      clientId,
      matterId: matter.id,
      channel: 'email',
      templateLabel: 'Status note',
      body: 'A preview only.',
      consent: { optedIn: true, namesFirm: true },
    });
    expect(drafted.status).toBe(201);
    const approved = await post(attorney, `/v1/outbox/${drafted.body.id}/approve`, {});
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('external_activation_gate');
    expect(approved.body.provider).toBe('unconfigured');
    const webhook = await owner.agent.post('/v1/webhooks/messages/mock').send({
      eventId: 'event-gate-0001',
      outboxId: drafted.body.id,
      status: 'mock_ack',
    });
    expect(webhook.status).toBe(503);
  });
});
