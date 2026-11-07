import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { DestinationStream } from 'pino';
import { AppModule } from './app.module';
import { LOGGER, type Logger } from './common/logger';
import { requestIdMiddleware } from './common/request-id.middleware';
import type { Env } from './config/env';

export interface CreateAppOptions {
  /** Where logs go (tests capture them to prove nothing sensitive is written). Defaults to stdout. */
  logDestination?: DestinationStream;
}

export async function createApp(
  env: Env,
  options: CreateAppOptions = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, options), {
    logger: env.NODE_ENV === 'test' ? false : ['error', 'warn'],
  });
  const logger = app.get<Logger>(LOGGER);
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.set('etag', false); // responses are private and never revalidated from a cache
  app.disable('x-powered-by');
  app.use(requestIdMiddleware(logger));

  // This is a JSON API: it never serves pages, so the strictest policy is the right one.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false, // only the directives below: nothing is loaded by a JSON API
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      // Same-site frontends (dashboard, portal) may use API responses; other sites may not embed them.
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: { maxAge: 15_552_000, includeSubDomains: true },
    }),
  );
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    );
    // Authenticated JSON must never be stored by browsers or shared caches. Handlers may override (signed downloads).
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Small JSON bodies only. File bytes never go through the API process (they use signed storage URLs).
  app.useBodyParser('json', { limit: env.MAX_JSON_BODY_BYTES });
  app.useBodyParser('urlencoded', { extended: false, limit: env.MAX_JSON_BODY_BYTES });
  app.use(cookieParser());
  app.enableCors({
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'idempotent-replayed', 'retry-after'],
    maxAge: 600,
  });
  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz', 'internal/storage'] });
  app.enableShutdownHooks();
  return app;
}
