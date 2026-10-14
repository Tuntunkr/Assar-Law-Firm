import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  MONGODB_URI: 'mongodb://x',
  SESSION_SECRET: 'a'.repeat(32),
  MFA_ENCRYPTION_KEY: 'b'.repeat(32),
};

describe('loadEnv', () => {
  it('applies safe defaults', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'production' });
    expect(env.cookieSecure).toBe(true);
    expect(env.REGISTRATION_ENABLED).toBe(false);
  });
  it('fails fast without echoing secret values', () => {
    expect(() => loadEnv({ ...base, SESSION_SECRET: 'too-short' })).toThrow(/SESSION_SECRET/);
    try {
      loadEnv({ ...base, SESSION_SECRET: 'too-short' });
    } catch (e) {
      expect(String(e)).not.toContain('too-short');
    }
  });
});
