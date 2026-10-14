import { ZodError } from 'zod';
import { AiProviderError } from './grok.js';
import { ExtractionError } from './extract.js';

/** A failure with an explicit retry decision and a message safe to store and show (never document text). */
export class JobFailure extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'JobFailure';
  }
}

export interface Described {
  code: string;
  message: string;
  retryable: boolean;
}

export function describeError(e: unknown): Described {
  if (e instanceof JobFailure || e instanceof AiProviderError)
    return { code: e.code, message: e.message, retryable: e.retryable };
  if (e instanceof ExtractionError) return { code: e.code, message: e.message, retryable: false };
  if (e instanceof ZodError || e instanceof SyntaxError) {
    return {
      code: 'MODEL_OUTPUT_INVALID',
      message: 'The AI response was not in the expected format',
      retryable: true,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred while processing the job',
    retryable: true,
  };
}
