import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { connectDatabase, disconnectDatabase, isDatabaseReady, mongoose } from '@assar/database';
import {
  GrokClient,
  JobQueues,
  createRedis,
  startHeartbeat,
  startWorkers,
  type JobLogger,
  type WorkerHandle,
} from '@assar/jobs';
import {
  ClamAvScanProvider,
  DisabledScanProvider,
  LocalStorage,
  S3Storage,
  type StorageService,
} from '@assar/storage';
import type { WorkerEnv } from './env.js';

export interface RunningWorker {
  /** Port the health server is listening on. */
  healthPort: number;
  workers: WorkerHandle;
  workerId: string;
  /** Stops accepting jobs, waits for running ones, then disconnects everything. */
  shutdown(): Promise<void>;
}

function createStorage(env: WorkerEnv): StorageService {
  return env.STORAGE_DRIVER === 's3'
    ? new S3Storage({
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION,
        accessKey: env.S3_ACCESS_KEY!,
        secretKey: env.S3_SECRET_KEY!,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      })
    : new LocalStorage({
        directory: env.STORAGE_LOCAL_DIR,
        signingSecret: env.SESSION_SECRET!,
        publicBaseUrl: env.PUBLIC_API_URL.replace(/\/$/, ''),
      });
}

export async function startWorkerApp(
  env: WorkerEnv,
  logger: JobLogger = pino({ level: env.LOG_LEVEL, redact: ['*.apiKey', '*.authorization'] }),
): Promise<RunningWorker> {
  const workerId = env.WORKER_ID ?? `${hostname()}-${randomUUID().slice(0, 8)}`;
  await connectDatabase(env.MONGODB_URI);

  const grok = env.GROK_API_KEY
    ? new GrokClient({
        apiKey: env.GROK_API_KEY,
        baseUrl: env.GROK_API_BASE_URL,
        model: env.GROK_MODEL!,
        timeoutMs: env.GROK_TIMEOUT_MS,
        maxOutputTokens: env.GROK_MAX_OUTPUT_TOKENS,
      })
    : null;
  if (!grok)
    logger.warn({}, 'GROK_API_KEY is not set: AI jobs will not be processed by this worker');

  const workers = startWorkers({
    redisUrl: env.REDIS_URL,
    prefix: env.QUEUE_PREFIX,
    logger,
    storage: createStorage(env),
    scanProvider:
      env.SCAN_PROVIDER === 'clamav'
        ? new ClamAvScanProvider(env.CLAMAV_HOST, env.CLAMAV_PORT)
        : new DisabledScanProvider(),
    grok,
    scanConcurrency: env.SCAN_CONCURRENCY,
    aiConcurrency: env.AI_CONCURRENCY,
    maxContextChars: env.AI_MAX_CONTEXT_CHARS,
    maxExtractBytes: env.AI_MAX_EXTRACT_BYTES,
    allowUnscanned: env.NODE_ENV !== 'production' && env.SCAN_PROVIDER === 'disabled',
  });

  const redis = createRedis(env.REDIS_URL);
  redis.on('error', () => undefined);
  const queues = new JobQueues({ redisUrl: env.REDIS_URL, prefix: env.QUEUE_PREFIX });
  const heartbeat = startHeartbeat({
    redis,
    prefix: env.QUEUE_PREFIX,
    workerId,
    host: hostname(),
    snapshot: () => ({ ...workers.stats(), version: '0.0.0' }),
  });

  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    void (async () => {
      if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
      if (req.url === '/healthz') return send(200, { status: 'ok', workerId });
      if (req.url === '/readyz' || req.url === '/status') {
        const checks = { mongodb: 'failing', redis: 'failing' };
        try {
          if (isDatabaseReady()) {
            await mongoose.connection.db?.admin().ping();
            checks.mongodb = 'ok';
          }
        } catch {
          /* reported below */
        }
        try {
          await queues.ping();
          checks.redis = 'ok';
        } catch {
          /* reported below */
        }
        const ready = Object.values(checks).every((c) => c === 'ok');
        if (req.url === '/readyz')
          return send(ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', checks });
        return send(ready ? 200 : 503, {
          workerId,
          checks,
          ...workers.stats(),
          queues: ready ? await queues.counts() : null,
        });
      }
      return send(404, { error: 'not found' });
    })().catch(() => send(500, { error: 'internal error' }));
  });
  await new Promise<void>((resolve) =>
    server.listen(env.WORKER_HEALTH_PORT, env.WORKER_HEALTH_HOST, resolve),
  );
  const healthPort = (server.address() as { port: number }).port;
  logger.info({ workerId, healthPort, aiEnabled: !!grok }, 'worker started');

  let closing: Promise<void> | null = null;
  return {
    healthPort,
    workers,
    workerId,
    shutdown() {
      closing ??= (async () => {
        logger.info({ workerId }, 'worker shutting down');
        await heartbeat.stop(); // disappear from the registry first
        await workers.close(); // let running jobs finish
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await queues.close();
        redis.disconnect();
        await disconnectDatabase();
      })();
      return closing;
    },
  };
}
