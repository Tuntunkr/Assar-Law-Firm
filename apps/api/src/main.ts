import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.factory';
import { loadEnv } from './config/env';

async function bootstrap() {
  // Local development convenience; production injects real environment variables.
  const envFile = resolve(process.cwd(), '../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.PORT);
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
