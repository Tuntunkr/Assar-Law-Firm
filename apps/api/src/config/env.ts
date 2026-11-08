import { z } from 'zod';
import { weakSecretReason } from '@assar/validation';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const object = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY must be at least 32 characters'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  REGISTRATION_ENABLED: bool.default('false'),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: bool.default('false'),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
  /** Per signed-in user / portal user, across all routes. Shared via Redis, so it holds across replicas. */
  PRINCIPAL_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(600),
  /** Per automation service token. */
  SERVICE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  MAX_JSON_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(256 * 1024),
  /** Previous MFA key, accepted for decryption while secrets are being re-encrypted (see rotate-mfa-key). */
  MFA_ENCRYPTION_KEY_PREVIOUS: z.string().min(32).optional(),
  GLOBAL_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(300),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(120),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(24),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- Document storage & scanning ---
  PUBLIC_API_URL: z.string().url().optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.data/storage'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default('false'),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(100 * 1024 * 1024),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(900),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(10).max(900).default(300),
  /** Which scanner the *worker* uses. `disabled` marks uploads `skipped` (never `clean`); refused in production. */
  SCAN_PROVIDER: z.enum(['clamav', 'disabled']).default('clamav'),

  // --- Job queue & AI (the worker holds the Grok credentials; the API never sees them) ---
  REDIS_URL: z.string().url(),
  QUEUE_PREFIX: z
    .string()
    .regex(/^[\w-]{1,40}$/)
    .default('assar'),
  /** Turns the AI endpoints on. The worker must also be configured with Grok credentials. */
  AI_ENABLED: bool.default('false'),
  /** Publish workflow events (matter.created, ...) to the queue for delivery to n8n by the worker. */
  WORKFLOWS_ENABLED: bool.default('false'),
  /**
   * `mock` records a delivery without a network call.
   * `whatsapp_cloud` uses the Cloud API adapter and still sends nothing until every credential below is set.
   * `unconfigured` is the default and is an activation gate.
   */
  MESSAGE_PROVIDER: z.enum(['mock', 'unconfigured', 'whatsapp_cloud']).default('unconfigured'),
  /** Required before the mock webhook will accept a callback. Never invent a value. */
  MESSAGE_WEBHOOK_SECRET: z.string().min(16).optional(),
  /**
   * Graph version from Meta's send-messages curl (page updated 4 Nov 2026), which uses v27.0.
   * Override only with the version printed in a later official curl. Do not invent one.
   */
  WHATSAPP_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v27.0'),
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .regex(/^\d{6,32}$/)
    .optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
  WHATSAPP_APP_SECRET: z.string().min(8).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8).optional(),
  /** Delay before a retry of HTTP 429 or 5xx. Tests set 0. Three attempts, then a failed row. */
  WHATSAPP_RETRY_BASE_MS: z.coerce.number().int().min(0).max(10_000).default(200),
  /**
   * `manual` does not fetch a court. `import` accepts a file the firm already obtained.
   * Neither mode calls a court website.
   */
  COURT_FEED: z.enum(['manual', 'import']).default('manual'),
  /**
   * `off` leaves email on the message-provider path.
   * `local` stores the approved email on this machine and does not open a socket.
   * `smtp` is accepted and still does not send. Live SMTP is deferred.
   */
  EMAIL_DELIVERY: z.enum(['off', 'local', 'smtp']).default('off'),
  /** `local` stores a synthetic demo booking. `off` stores nothing. */
  DEMO_BOOKING: z.enum(['off', 'local']).default('off'),
  AI_MAX_ACTIVE_JOBS_PER_ORG: z.coerce.number().int().min(1).default(5),
  AI_JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SCAN_JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  JOB_BACKOFF_MS: z.coerce.number().int().min(10).default(5000),
});

const schema = object.superRefine((env, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (env.STORAGE_DRIVER === 's3') {
    for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
      if (!env[k]) issue(k, 'Required when STORAGE_DRIVER=s3');
    }
  }
  if (env.NODE_ENV === 'production') {
    for (const k of ['SESSION_SECRET', 'MFA_ENCRYPTION_KEY'] as const) {
      const why = weakSecretReason(env[k]);
      if (why) issue(k, `Not safe for production: ${why}`);
    }
    if (env.SESSION_SECRET === env.MFA_ENCRYPTION_KEY)
      issue('MFA_ENCRYPTION_KEY', 'Must differ from SESSION_SECRET');
    if (env.COOKIE_SECURE === false) issue('COOKIE_SECURE', 'Cookies must be Secure in production');
    if (env.CORS_ORIGINS.length === 0) issue('CORS_ORIGINS', 'List the exact frontend origins');
    for (const o of env.CORS_ORIGINS) {
      if (o === '*' || !o.startsWith('https://'))
        issue('CORS_ORIGINS', `"${o}" must be an https:// origin (no wildcards)`);
    }
    if (env.STORAGE_DRIVER === 'local')
      issue('STORAGE_DRIVER', 'The local driver is for development only');
    if (env.SCAN_PROVIDER === 'disabled')
      issue('SCAN_PROVIDER', 'Upload scanning cannot be disabled in production');
  }
});

export type Env = z.output<typeof schema> & { cookieSecure: boolean; publicApiUrl: string };
export const ENV = Symbol('ENV');

/** Fails fast with a readable message; never prints values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  return {
    ...env,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    publicApiUrl: (env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, ''),
  };
}
