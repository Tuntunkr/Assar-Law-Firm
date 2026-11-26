import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * WhatsApp Cloud API adapter.
 *
 * Default graph version is the one in Meta's official send curl on the page
 * "Send messages", updated 4 Nov 2026:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
 * That curl posts to https://graph.facebook.com/v27.0/{PHONE_NUMBER_ID}/messages.
 * An older template-creation example on the template fundamentals page uses v23.0.
 * This file does not treat v23.0 as the send default and does not invent a newer version.
 * WHATSAPP_GRAPH_VERSION can be set to the version in a later official curl.
 *
 * Template name and language rules: template fundamentals, updated 21 May 2026.
 * Status webhook fields: "Status messages webhook reference", updated 4 Nov 2026.
 * Signature: X-Hub-Signature-256 is sha256= of HMAC-SHA256 over the raw body with the app secret
 * (Graph webhooks getting started).
 *
 * A successful HTTP response means the message was accepted, not delivered and not that a template
 * is approved. This module never calls the template-status endpoint and never sets an approval claim.
 */

export const DOCUMENTED_SEND_VERSION = 'v27.0';
export const GRAPH_HOST = 'graph.facebook.com';
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
/** Matches the documented language object, for example en_US. */
export const TEMPLATE_LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
/** Meta's send page says to include a plus and the country code. This does not invent a country. */
export const E164 = /^\+[1-9]\d{7,14}$/;

const STATUS_VALUES = ['sent', 'delivered', 'read', 'failed', 'played'] as const;
export type WhatsAppStatus = (typeof STATUS_VALUES)[number];

export interface WhatsAppConfig {
  version: string;
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  retryBaseMs: number;
}

export function whatsappConfig(env: {
  MESSAGE_PROVIDER: string;
  WHATSAPP_GRAPH_VERSION: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_RETRY_BASE_MS: number;
}): WhatsAppConfig | null {
  if (env.MESSAGE_PROVIDER !== 'whatsapp_cloud') return null;
  if (
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !env.WHATSAPP_ACCESS_TOKEN ||
    !env.WHATSAPP_APP_SECRET ||
    !env.WHATSAPP_VERIFY_TOKEN
  ) {
    return null;
  }
  return {
    version: env.WHATSAPP_GRAPH_VERSION,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    retryBaseMs: env.WHATSAPP_RETRY_BASE_MS,
  };
}

/** True only when a recorded inbound message is inside the documented 24-hour customer service window. */
export function customerServiceWindowOpen(inboundAt: Date | null, now: Date): boolean {
  if (!inboundAt) return false;
  const age = now.getTime() - inboundAt.getTime();
  return age >= 0 && age < CUSTOMER_SERVICE_WINDOW_MS;
}

/**
 * Free-form service text is allowed only inside that window. Firm updates in this product are
 * templates, which the send-messages page allows outside the window. This function refuses a
 * free-form send when the window is closed. It does not claim the template itself is approved.
 */
export function freeFormAllowed(inboundAt: Date | null, now: Date): boolean {
  return customerServiceWindowOpen(inboundAt, now);
}

export function messagesUrl(cfg: WhatsAppConfig): string {
  return `https://${GRAPH_HOST}/${cfg.version}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
}

export function buildTemplateBody(input: {
  to: string;
  templateName: string;
  languageCode: string;
  bodyParameters: string[];
  outboxId: string;
}): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!E164.test(input.to)) return { ok: false, error: 'recipient_not_e164' };
  if (!TEMPLATE_NAME.test(input.templateName)) return { ok: false, error: 'template_name' };
  if (!TEMPLATE_LANGUAGE.test(input.languageCode)) return { ok: false, error: 'template_language' };
  const template: Record<string, unknown> = {
    name: input.templateName,
    language: { code: input.languageCode },
  };
  if (input.bodyParameters.length > 0) {
    template.components = [
      {
        type: 'body',
        parameters: input.bodyParameters.map((text) => ({ type: 'text', text })),
      },
    ];
  }
  return {
    ok: true,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'template',
      template,
      biz_opaque_callback_data: input.outboxId,
    },
  };
}

export interface SendSuccess {
  ok: true;
  messageId: string;
  attempts: number;
}
export interface SendFailure {
  ok: false;
  error: string;
  attempts: number;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export async function sendTemplate(
  cfg: WhatsAppConfig,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<SendSuccess | SendFailure> {
  const url = messagesUrl(cfg);
  let lastError = 'network';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const parsed = (await res.json().catch(() => null)) as {
          messages?: { id?: string }[];
        } | null;
        const id = parsed?.messages?.[0]?.id;
        if (!id) return { ok: false, error: 'accepted_without_id', attempts: attempt };
        return { ok: true, messageId: id, attempts: attempt };
      }
      lastError = `http_${res.status}`;
      if (!RETRYABLE.has(res.status) || attempt === 3) {
        return { ok: false, error: lastError, attempts: attempt };
      }
    } catch {
      lastError = 'network';
      if (attempt === 3) return { ok: false, error: lastError, attempts: attempt };
    }
    await sleep(cfg.retryBaseMs * 2 ** (attempt - 1));
  }
  return { ok: false, error: lastError, attempts: 3 };
}

export function signBody(secret: string, raw: Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

export function signatureMatches(secret: string, raw: Buffer, header: string): boolean {
  const expected = signBody(secret, raw);
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hubChallenge(query: Record<string, unknown>, verifyToken: string): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string')
    return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^[\w.-]{1,256}$/.test(challenge)) return null;
  return challenge;
}

export interface StatusEvent {
  messageId: string;
  status: WhatsAppStatus;
  timestamp: string;
  phoneNumberId: string | null;
  errorCode: number | null;
  eventKey: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Reads status objects from the documented messages webhook. Ignores anything else. */
export function parseStatusWebhook(body: unknown): StatusEvent[] {
  const root = asRecord(body);
  if (!root || root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return [];
  const events: StatusEvent[] = [];
  for (const entry of root.entry) {
    const changes = asRecord(entry)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const row = asRecord(change);
      if (!row || row.field !== 'messages') continue;
      const value = asRecord(row.value);
      if (!value || value.messaging_product !== 'whatsapp' || !Array.isArray(value.statuses))
        continue;
      const phone = asRecord(value.metadata)?.phone_number_id;
      const phoneNumberId = typeof phone === 'string' ? phone : null;
      for (const item of value.statuses) {
        const status = asRecord(item);
        if (!status) continue;
        const messageId = status.id;
        const name = status.status;
        const timestamp = status.timestamp;
        if (
          typeof messageId !== 'string' ||
          typeof name !== 'string' ||
          typeof timestamp !== 'string'
        )
          continue;
        if (!STATUS_VALUES.includes(name as WhatsAppStatus)) continue;
        const errors = Array.isArray(status.errors) ? status.errors : [];
        const code = asRecord(errors[0])?.code;
        events.push({
          messageId,
          status: name as WhatsAppStatus,
          timestamp,
          phoneNumberId,
          errorCode: typeof code === 'number' ? code : null,
          eventKey: `${messageId}:${name}:${timestamp}`,
        });
      }
    }
  }
  return events;
}

/** Higher ranks are later in the documented lifecycle. A later status is not replaced by an earlier one. */
export function statusRank(status: string): number {
  switch (status) {
    case 'accepted':
      return 1;
    case 'sent':
      return 2;
    case 'delivered':
      return 3;
    case 'read':
    case 'played':
      return 4;
    case 'failed':
      return 5;
    default:
      return 0;
  }
}
