import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { LOGGER, type Logger } from './common/logger';
import { requestIdMiddleware } from './common/request-id.middleware';
import type { Env } from './config/env';

export async function createApp(env: Env): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    logger: env.NODE_ENV === 'test' ? false : ['error', 'warn'],
  });
  const logger = app.get<Logger>(LOGGER);
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');
  app.use(requestIdMiddleware(logger));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'idempotent-replayed'],
  });
  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
  app.enableShutdownHooks();
  return app;
}
