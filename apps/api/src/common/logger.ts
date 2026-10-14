import pino from 'pino';

export const LOGGER = Symbol('LOGGER');
export type Logger = pino.Logger;

/**
 * Structured JSON logs. Request/response bodies are never logged; redaction is a second line of defence.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'password',
        '*.password',
        'token',
        '*.token',
        '*.secret',
      ],
      censor: '[redacted]',
    },
  });
}
