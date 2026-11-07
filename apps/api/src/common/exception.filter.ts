import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ExceptionFilter,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import type { ApiErrorBody, ErrorCode } from '@assar/types';
import { InvalidCursorError } from '@assar/database';
import type { AppRequest } from './auth-context';
import { LOGGER, type Logger } from './logger';
import { ValidationFailed } from './zod.pipe';

/** Domain error carrying an API error code. */
export class ApiError extends HttpException {
  constructor(
    status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message, status);
  }
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/** Errors thrown by Express's body parser (http-errors): too large, malformed JSON, bad charset/encoding. */
function isBodyParserError(e: unknown): e is { status: number; type: string } {
  const x = e as { status?: unknown; type?: unknown };
  return (
    typeof x?.status === 'number' &&
    x.status >= 400 &&
    x.status < 500 &&
    typeof x.type === 'string' &&
    /^(entity\.|encoding\.|charset\.|request\.)/.test(x.type)
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const res = http.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'INTERNAL';
    let message = 'Internal server error';
    let details: unknown[] | undefined;

    if (exception instanceof ValidationFailed) {
      status = 400;
      code = 'VALIDATION_FAILED';
      message = 'Validation failed';
      details = exception.issues;
    } else if (exception instanceof InvalidCursorError) {
      status = 400;
      code = 'VALIDATION_FAILED';
      message = 'Invalid pagination cursor';
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      code = 'RATE_LIMITED';
      message = 'Too many requests';
    } else if (isBodyParserError(exception)) {
      // Never echo the parser's message: it can quote the offending input.
      status = exception.status;
      code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED';
      message =
        status === 413
          ? 'Request body is too large'
          : status === 415
            ? 'Unsupported content type'
            : 'Malformed request body';
    } else if (exception instanceof ApiError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'INTERNAL';
      // A bare 400 here comes from Nest's mapping of body-parser/URI errors, whose text can quote the request.
      message =
        status >= 500
          ? 'Internal server error'
          : status === 400
            ? 'Malformed request'
            : exception.message;
    } else if ((exception as { code?: number })?.code === 11000) {
      status = 409;
      code = 'CONFLICT';
      message = 'Resource already exists';
    }

    if (status >= 500) {
      // Log the error object, never request bodies.
      this.logger.error({ err: exception, requestId: req.id, path: req.path }, 'unhandled error');
    }
    const body: ApiErrorBody = {
      error: { code, message, requestId: req.id, ...(details ? { details } : {}) },
    };
    res.status(status).json(body);
  }
}
