import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { idempotency } from '@assar/database';
import type { AppRequest } from './auth-context';
import { sha256 } from './crypto';
import { IDEMPOTENT_KEY } from './decorators';
import { ApiError } from './exception.filter';

/**
 * Makes a POST safe to retry. The first request with a given key runs; later ones with the same body
 * replay the stored response (minus `redact` fields, so secrets are never persisted).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const opts = this.reflector.get<{ redact?: string[] } | undefined>(
      IDEMPOTENT_KEY,
      ctx.getHandler(),
    );
    if (!opts) return next.handle();

    const http = ctx.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const res = http.getResponse<Response>();
    const orgId = req.auth?.organizationId;
    const key = req.header('idempotency-key');
    if (!orgId) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    if (!key || !/^[\w-]{8,128}$/.test(key)) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'A valid Idempotency-Key header (8-128 chars) is required',
      );
    }

    const hash = sha256(`${req.method}:${req.path}:${JSON.stringify(req.body ?? {})}`);
    const existing = await idempotency.begin(orgId, key, hash);
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new ApiError(
          422,
          'IDEMPOTENCY_MISMATCH',
          'Idempotency-Key was already used with a different request',
        );
      }
      if (existing.status === 'processing')
        throw new ApiError(409, 'CONFLICT', 'A request with this key is still in progress');
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.responseStatus ?? 200);
      return of(existing.responseBody);
    }

    return next.handle().pipe(
      mergeMap((body) => {
        const stored =
          body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : body;
        if (stored && typeof stored === 'object')
          for (const f of opts.redact ?? []) delete (stored as Record<string, unknown>)[f];
        return from(idempotency.complete(orgId, key, res.statusCode, stored)).pipe(
          mergeMap(() => of(body)),
        );
      }),
      catchError((err) =>
        from(idempotency.release(orgId, key)).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }
}
