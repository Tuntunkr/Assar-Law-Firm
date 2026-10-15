export const QUEUE_NAMES = { scan: 'assar-scan', ai: 'assar-ai', events: 'assar-events' } as const;

export interface ScanJobData {
  organizationId: string;
  versionId: string;
}
export interface AiJobData {
  organizationId: string;
  aiJobId: string;
}

/** An outbound workflow event. `data` holds ids and names of things only: never document text, prompts or personal data. */
export interface WorkflowEventData {
  event: string;
  organizationId: string;
  occurredAt: string;
  data: Record<string, string | number | boolean | null>;
}

/** Where processors announce events (the real implementation enqueues them for delivery). */
export interface EventSink {
  publish(evt: {
    event: string;
    organizationId: string;
    data: WorkflowEventData['data'];
  }): Promise<void>;
}

/** Minimal logger shape (pino-compatible). Never pass document text or prompts to it. */
export interface JobLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLogger: JobLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
