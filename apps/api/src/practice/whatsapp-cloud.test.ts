import { describe, expect, it, vi } from 'vitest';
import {
  DOCUMENTED_SEND_VERSION,
  buildTemplateBody,
  customerServiceWindowOpen,
  freeFormAllowed,
  hubChallenge,
  messagesUrl,
  parseStatusWebhook,
  sendTemplate,
  signBody,
  signatureMatches,
  statusRank,
  whatsappConfig,
  type WhatsAppConfig,
} from './whatsapp-cloud';

const cfg: WhatsAppConfig = {
  version: DOCUMENTED_SEND_VERSION,
  phoneNumberId: '106540352242922',
  accessToken: 'test-token-not-a-real-credential',
  appSecret: 'test-app-secret',
  verifyToken: 'test-verify-token',
  retryBaseMs: 0,
};

describe('WhatsApp Cloud API adapter', () => {
  it('uses the documented send host and version and refuses a free-form send outside the window', () => {
    expect(messagesUrl(cfg)).toBe('https://graph.facebook.com/v27.0/106540352242922/messages');
    const now = new Date('2026-11-07T12:00:00.000Z');
    expect(customerServiceWindowOpen(null, now)).toBe(false);
    expect(freeFormAllowed(null, now)).toBe(false);
    expect(freeFormAllowed(new Date('2026-11-07T10:00:00.000Z'), now)).toBe(true);
    expect(freeFormAllowed(new Date('2026-11-06T11:00:00.000Z'), now)).toBe(false);
    expect(
      whatsappConfig({
        MESSAGE_PROVIDER: 'unconfigured',
        WHATSAPP_GRAPH_VERSION: 'v27.0',
        WHATSAPP_RETRY_BASE_MS: 0,
      }),
    ).toBeNull();
    expect(
      whatsappConfig({
        MESSAGE_PROVIDER: 'whatsapp_cloud',
        WHATSAPP_GRAPH_VERSION: 'v27.0',
        WHATSAPP_RETRY_BASE_MS: 0,
      }),
    ).toBeNull();
  });

  it('builds the documented template body and rejects a name or number the docs do not allow', () => {
    const built = buildTemplateBody({
      to: '+16505551234',
      templateName: 'hearing_update',
      languageCode: 'en_US',
      bodyParameters: ['Tuesday'],
      outboxId: 'abc',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+16505551234',
      type: 'template',
      template: {
        name: 'hearing_update',
        language: { code: 'en_US' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Tuesday' }] }],
      },
      biz_opaque_callback_data: 'abc',
    });
    expect(buildTemplateBody({ ...blank(), templateName: 'Hearing Update' }).ok).toBe(false);
    expect(buildTemplateBody({ ...blank(), to: '16505551234' }).ok).toBe(false);
    expect(buildTemplateBody({ ...blank(), languageCode: 'english' }).ok).toBe(false);
  });

  it('retries a 500 and stops on a 400 without calling any host except the mock', async () => {
    const payload = { messaging_product: 'whatsapp' };
    let calls = 0;
    const flaky = vi.fn(async (url: string) => {
      expect(url).toBe(messagesUrl(cfg));
      expect(url).not.toMatch(/graph\.facebook\.com\/v(?!27\.0)/);
      calls++;
      if (calls === 1) return new Response('no', { status: 500 });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }), { status: 200 });
    });
    const ok = await sendTemplate(
      cfg,
      payload,
      flaky as unknown as typeof fetch,
      async () => undefined,
    );
    expect(ok).toEqual({ ok: true, messageId: 'wamid.TEST', attempts: 2 });

    const rejected = vi.fn(async () => new Response('no', { status: 400 }));
    const bad = await sendTemplate(
      cfg,
      payload,
      rejected as unknown as typeof fetch,
      async () => undefined,
    );
    expect(bad).toEqual({ ok: false, error: 'http_400', attempts: 1 });
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('checks the documented signature and reads a status webhook once per event', () => {
    const raw = Buffer.from('{"object":"whatsapp_business_account"}');
    const header = signBody(cfg.appSecret, raw);
    expect(signatureMatches(cfg.appSecret, raw, header)).toBe(true);
    expect(signatureMatches(cfg.appSecret, raw, 'sha256=nope')).toBe(false);
    expect(
      hubChallenge(
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': cfg.verifyToken,
          'hub.challenge': '1158201444',
        },
        cfg.verifyToken,
      ),
    ).toBe('1158201444');
    expect(
      hubChallenge(
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'other-token-value',
          'hub.challenge': '1158201444',
        },
        cfg.verifyToken,
      ),
    ).toBeNull();

    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: cfg.phoneNumberId },
                statuses: [
                  {
                    id: 'wamid.TEST',
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
    const events = parseStatusWebhook(body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      messageId: 'wamid.TEST',
      status: 'sent',
      eventKey: 'wamid.TEST:sent:1750030073',
    });
    expect(parseStatusWebhook({ object: 'page' })).toEqual([]);
    expect(statusRank('read')).toBeGreaterThan(statusRank('sent'));
    expect(statusRank('failed')).toBeGreaterThan(statusRank('delivered'));
  });
});

function blank() {
  return {
    to: '+16505551234',
    templateName: 'hearing_update',
    languageCode: 'en_US',
    bodyParameters: [] as string[],
    outboxId: 'abc',
  };
}
