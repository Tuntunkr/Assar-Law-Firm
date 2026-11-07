import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signBody } from '../src/practice/whatsapp-cloud';
import { addMember, bootApp, newClient, newMatter, patch, post, registerWithMfa } from './helpers';

const PHONE_NUMBER_ID = '106540352242922';
const APP_SECRET = 'test-app-secret';
const TOKEN = 'test-access-token-not-live';

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (!target.startsWith('https://graph.facebook.com/')) {
      throw new Error(`refusing unexpected host ${target}`);
    }
    return handler(target, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe('WhatsApp Cloud API adapter against a mock HTTP client', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp({
      MESSAGE_PROVIDER: 'whatsapp_cloud',
      WHATSAPP_GRAPH_VERSION: 'v27.0',
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TOKEN,
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
      WHATSAPP_RETRY_BASE_MS: '0',
    });
  });
  afterAll(() => app.close());

  async function draft() {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    await patch(owner, `/v1/clients/${clientId}`, { phone: '+16505551234' });
    const matter = await newMatter(owner, clientId);
    const drafted = await post(attorney, '/v1/outbox', {
      clientId,
      matterId: matter.id,
      channel: 'whatsapp',
      templateLabel: 'Hearing update',
      templateName: 'hearing_update',
      templateLanguage: 'en_US',
      bodyParameters: ['Tuesday'],
      body: 'The hearing date was typed from the brief.',
      consent: {
        optedIn: true,
        namesFirm: true,
        note: 'The client asked the firm for WhatsApp updates.',
      },
    });
    expect(drafted.status).toBe(201);
    expect(drafted.body.providerTemplateApproval).toBe('not_claimed');
    return { owner, attorney, drafted };
  }

  it('accepts a template send on the documented URL and then applies status callbacks once', async () => {
    const { attorney, drafted } = await draft();
    const http = installFetch(
      async () =>
        new Response(JSON.stringify({ messages: [{ id: 'wamid.ONE' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    try {
      const approved = await post(attorney, `/v1/outbox/${drafted.body.id}/approve`, {});
      expect(approved.status).toBe(201);
      expect(approved.body).toMatchObject({
        status: 'accepted',
        provider: 'whatsapp_cloud',
        providerMessageId: 'wamid.ONE',
        providerTemplateApproval: 'not_claimed',
        attempts: 1,
      });
      expect(http.calls).toHaveLength(1);
      expect(http.calls[0]?.url).toBe(
        `https://graph.facebook.com/v27.0/${PHONE_NUMBER_ID}/messages`,
      );
      const sentBody = JSON.parse(String(http.calls[0]?.init?.body));
      expect(sentBody).toMatchObject({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '+16505551234',
        type: 'template',
        template: { name: 'hearing_update', language: { code: 'en_US' } },
      });
      expect(http.calls[0]?.init?.redirect).toBe('error');
      expect(
        String(
          http.calls[0]?.init?.headers &&
            (http.calls[0]?.init?.headers as Record<string, string>).Authorization,
        ),
      ).toBe(`Bearer ${TOKEN}`);
    } finally {
      http.restore();
    }

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [
                  {
                    id: 'wamid.ONE',
                    status: 'sent',
                    timestamp: '1750030073',
                    recipient_id: '16505551234',
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const call = (body: string, signature: string) =>
      request(app.getHttpServer())
        .post('/v1/webhooks/whatsapp')
        .set('content-type', 'application/json')
        .set('x-hub-signature-256', signature)
        .send(body);
    const first = await call(raw, signBody(APP_SECRET, Buffer.from(raw)));
    expect(first.status).toBe(200);
    expect(first.body.results[0]).toMatchObject({ replayed: false, status: 'sent' });
    const replay = await call(raw, signBody(APP_SECRET, Buffer.from(raw)));
    expect(replay.body.results[0]).toMatchObject({ replayed: true, status: 'sent' });
    const bad = await call(raw, 'sha256=deadbeef');
    expect(bad.status).toBe(401);

    const delivered = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [{ id: 'wamid.ONE', status: 'delivered', timestamp: '1750030080' }],
              },
            },
          ],
        },
      ],
    });
    const moved = await call(delivered, signBody(APP_SECRET, Buffer.from(delivered)));
    expect(moved.body.results[0].status).toBe('delivered');
    const older = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [{ id: 'wamid.ONE', status: 'sent', timestamp: '1750030090' }],
              },
            },
          ],
        },
      ],
    });
    const kept = await call(older, signBody(APP_SECRET, Buffer.from(older)));
    expect(kept.body.results[0].status).toBe('delivered');

    const handshake = await request(app.getHttpServer()).get('/v1/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-verify-token',
      'hub.challenge': '1158201444',
    });
    expect(handshake.status).toBe(200);
    expect(handshake.text).toBe('1158201444');
  });

  it('retries a provider 500 and does not call the network when credentials are absent', async () => {
    const { attorney, drafted } = await draft();
    let calls = 0;
    const http = installFetch(async () => {
      calls++;
      if (calls < 3) return new Response('busy', { status: 500 });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.RETRY' }] }), { status: 200 });
    });
    try {
      const approved = await post(attorney, `/v1/outbox/${drafted.body.id}/approve`, {});
      expect(approved.body).toMatchObject({
        status: 'accepted',
        providerMessageId: 'wamid.RETRY',
        attempts: 3,
      });
    } finally {
      http.restore();
    }
  });
});

describe('WhatsApp stays gated when the flag is on and the keys are missing', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp({ MESSAGE_PROVIDER: 'whatsapp_cloud' });
  });
  afterAll(() => app.close());

  it('does not call fetch', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const matter = await newMatter(owner, clientId);
    const drafted = await post(attorney, '/v1/outbox', {
      clientId,
      matterId: matter.id,
      channel: 'whatsapp',
      templateLabel: 'Hearing update',
      templateName: 'hearing_update',
      templateLanguage: 'en_US',
      body: 'This must stay inside the firm.',
      consent: { optedIn: true, namesFirm: true },
    });
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error('network was called');
    }) as typeof fetch;
    try {
      const approved = await post(attorney, `/v1/outbox/${drafted.body.id}/approve`, {});
      expect(approved.body).toMatchObject({
        status: 'external_activation_gate',
        provider: 'whatsapp_cloud',
        providerError: 'missing_credentials',
        providerTemplateApproval: 'not_claimed',
      });
      expect(called).toBe(false);
      const hook = await request(app.getHttpServer())
        .post('/v1/webhooks/whatsapp')
        .send({ object: 'whatsapp_business_account' });
      expect(hook.status).toBe(503);
    } finally {
      globalThis.fetch = original;
    }
  });
});
