import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { Logger } from './logger';
import type { AppRequest } from './auth-context';

export function requestIdMiddleware(logger: Logger) {
  return (req: AppRequest, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', req.id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info(
        {
          requestId: req.id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
          userId: req.auth?.userId,
          organizationId: req.auth?.organizationId,
        },
        'request',
      );
    });
    next();
  };
}
