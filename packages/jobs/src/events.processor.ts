import { createHmac } from 'node:crypto';
import { UnrecoverableError, type Job } from 'bullmq';
import type { JobLogger, WorkflowEventData } from './names.js';

export interface EventsProcessorDeps {
  /**
   * Base URL of the n8n webhooks, e.g. https://n8n.example.com/webhook/assar. Each event goes to
   * `<base>/<event name with dots as dashes>` (matter.created -> .../matter-created), so each workflow
   * owns exactly one webhook path.
   */
  baseUrl: string;
  /** Shared secret. Sent as a header token (checked by n8n's Header Auth) and used to HMAC-sign each delivery. */
  secret: string;
  logger: JobLogger;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** `document.scan_clean` -> `document-scan-clean`: the path segment of the workflow that handles the event. */
export const eventSlug = (event: string) => event.replace(/[._]/g, '-');

export const eventUrl = (baseUrl: string, event: string) =>
  `${baseUrl.replace(/\/+$/, '')}/${eventSlug(event)}`;

export function signEvent(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Delivers workflow events to n8n. Payloads contain ids only. Transient failures (network, 408/429/5xx)
 * are retried by the queue; other 4xx responses mean the receiver rejected the event and are not retried.
 */
export function createEventsProcessor(deps: EventsProcessorDeps) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  return async (job: Job<WorkflowEventData>): Promise<void> => {
    const body = JSON.stringify({ id: job.id, ...job.data });
    const timestamp = String(Math.floor(Date.now() / 1000));
    let status: number;
    try {
      const res = await doFetch(eventUrl(deps.baseUrl, job.data.event), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-assar-event': job.data.event,
          'x-assar-timestamp': timestamp,
          'x-assar-signature': signEvent(deps.secret, timestamp, body),
          'x-assar-webhook-token': deps.secret,
        },
        body,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
      });
      status = res.status;
      await res.arrayBuffer().catch(() => undefined); // drain; never read or log the response body
    } catch {
      deps.logger.warn(
        { event: job.data.event, attempt: job.attemptsMade + 1 },
        'workflow event delivery failed (network)',
      );
      throw new Error('workflow endpoint unreachable');
    }
    if (status >= 200 && status < 300) return;
    // 404 is retried too: n8n answers 404 while it is starting up or the workflow is not active yet.
    const retryable = status === 404 || status === 408 || status === 429 || status >= 500;
    deps.logger.warn(
      { event: job.data.event, status, retryable, attempt: job.attemptsMade + 1 },
      'workflow event rejected',
    );
    if (!retryable)
      throw new UnrecoverableError(`workflow endpoint rejected the event (HTTP ${status})`);
    throw new Error(`workflow endpoint returned HTTP ${status}`);
  };
}
