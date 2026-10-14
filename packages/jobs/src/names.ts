export const QUEUE_NAMES = { scan: 'assar-scan', ai: 'assar-ai' } as const;

export interface ScanJobData {
  organizationId: string;
  versionId: string;
}
export interface AiJobData {
  organizationId: string;
  aiJobId: string;
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
