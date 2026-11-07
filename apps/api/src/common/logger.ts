import pino from 'pino';

export const LOGGER = Symbol('LOGGER');
export type Logger = pino.Logger;

/**
 * Structured JSON logs. Request/response bodies are never logged; redaction is a second line of defence.
 */
export function createLogger(level: string, destination?: pino.DestinationStream): Logger {
  return pino(
    {
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
          '*.currentPassword',
          '*.newPassword',
          '*.mfaCode',
          '*.passwordHash',
          '*.authorization',
          '*.cookie',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
    },
    destination,
  );
}
