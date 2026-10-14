import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
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
  GLOBAL_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(300),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(120),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(24),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.output<typeof schema> & { cookieSecure: boolean };
export const ENV = Symbol('ENV');

/** Fails fast with a readable message; never prints values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  return { ...env, cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production' };
}
