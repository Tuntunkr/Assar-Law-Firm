import type { Env } from '../config/env';

/**
 * Settings that are allowed but deserve a loud log line at startup. Hard errors are in the env schema;
 * these are judgement calls an operator should confirm on purpose.
 */
export function securityWarnings(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const w: string[] = [];
  if (env.REGISTRATION_ENABLED)
    w.push(
      'REGISTRATION_ENABLED=true: anyone can create an organization. Disable it once your pilot firms exist.',
    );
  if (!env.TRUST_PROXY)
    w.push(
      'TRUST_PROXY=false: behind a load balancer every request appears to come from the proxy, so IP rate limits and audit IPs are wrong. Set it when running behind one.',
    );
  if (env.TRUST_PROXY && env.CORS_ORIGINS.length === 0) w.push('CORS_ORIGINS is empty.');
  if (!env.AI_ENABLED && env.WORKFLOWS_ENABLED)
    w.push('WORKFLOWS_ENABLED=true while AI is disabled: confirm that is intended.');
  if (env.SESSION_ABSOLUTE_HOURS > 24 * 7)
    w.push(
      `SESSION_ABSOLUTE_HOURS=${env.SESSION_ABSOLUTE_HOURS}: sessions may live longer than a week.`,
    );
  if (env.SESSION_IDLE_MINUTES > 8 * 60)
    w.push(
      `SESSION_IDLE_MINUTES=${env.SESSION_IDLE_MINUTES}: idle sessions stay open longer than a working day.`,
    );
  if (env.PRINCIPAL_RATE_LIMIT_PER_MIN > 3000)
    w.push('PRINCIPAL_RATE_LIMIT_PER_MIN is very high; the limit may not slow down abuse.');
  return w;
}
