import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startWorkerApp } from './app.js';
import { loadWorkerEnv } from './env.js';

// Local development convenience; production injects real environment variables.
const envFile = resolve(process.cwd(), '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

try {
  const running = await startWorkerApp(loadWorkerEnv());
  const stop = (signal: string) => {
    console.log(`received ${signal}`);
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    running.shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
