import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.string().url(),
    QUEUE_PREFIX: z
      .string()
      .regex(/^[\w-]{1,40}$/)
      .default('assar'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Health/status HTTP server. Bind to localhost unless a load balancer needs it. */
    WORKER_HEALTH_PORT: z.coerce.number().int().min(0).default(4100),
    WORKER_HEALTH_HOST: z.string().default('127.0.0.1'),
    WORKER_ID: z.string().min(1).max(64).optional(),
    SCAN_CONCURRENCY: z.coerce.number().int().min(1).default(4),
    AI_CONCURRENCY: z.coerce.number().int().min(1).default(2),

    // --- Storage (same settings as the API: the worker reads uploaded files) ---
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./.data/storage'),
    SESSION_SECRET: z.string().min(32).optional(),
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default('false'),

    // --- Scanning ---
    SCAN_PROVIDER: z.enum(['clamav', 'disabled']).default('clamav'),
    CLAMAV_HOST: z.string().default('127.0.0.1'),
    CLAMAV_PORT: z.coerce.number().int().default(3310),

    // --- Grok: only the worker ever holds these. Leave GROK_API_KEY unset to run without AI. ---
    GROK_API_KEY: z.string().min(1).optional(),
    GROK_API_BASE_URL: z.string().url().default('https://api.x.ai/v1'),
    GROK_MODEL: z.string().min(1).optional(),
    GROK_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
    GROK_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(4096),
    AI_MAX_CONTEXT_CHARS: z.coerce.number().int().min(1000).default(120_000),
    AI_MAX_EXTRACT_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .default(25 * 1024 * 1024),
  })
  .superRefine((e, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (e.GROK_API_KEY && !e.GROK_MODEL)
      issue('GROK_MODEL', 'Required when GROK_API_KEY is set (no model is assumed)');
    if (e.STORAGE_DRIVER === 'local' && !e.SESSION_SECRET)
      issue('SESSION_SECRET', 'Required for the local storage driver (must match the API)');
    if (e.STORAGE_DRIVER === 's3') {
      for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const)
        if (!e[k]) issue(k, 'Required when STORAGE_DRIVER=s3');
    }
    if (e.NODE_ENV === 'production') {
      if (e.STORAGE_DRIVER === 'local')
        issue('STORAGE_DRIVER', 'The local driver is for development only');
      if (e.SCAN_PROVIDER === 'disabled')
        issue('SCAN_PROVIDER', 'Upload scanning cannot be disabled in production');
    }
  });

export type WorkerEnv = z.output<typeof schema>;

/** Fails fast with a readable message; never prints values. */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}
