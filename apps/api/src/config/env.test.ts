import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const STRONG = {
  SESSION_SECRET: 'k9Qw3vT7nXz2LpA8sDf6HgJ4mBc1RyUe',
  MFA_ENCRYPTION_KEY: 'R7vU2yTq0nWk5bHx9ZsJ4dGc8LmPe1Af',
  CORS_ORIGINS: 'https://app.example.com',
};
const base = {
  MONGODB_URI: 'mongodb://x',
  SESSION_SECRET: 'a'.repeat(32),
  MFA_ENCRYPTION_KEY: 'b'.repeat(32),
  REDIS_URL: 'redis://127.0.0.1:6380',
};

describe('loadEnv', () => {
  it('applies safe defaults', () => {
    const env = loadEnv({
      ...base,
      ...STRONG,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'b',
      S3_ACCESS_KEY: 'k',
      S3_SECRET_KEY: 's',
    });
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

  it('refuses unsafe storage and scanning settings in production', () => {
    const prod = { ...base, ...STRONG, NODE_ENV: 'production' };
    expect(() => loadEnv({ ...prod, STORAGE_DRIVER: 'local', SCAN_PROVIDER: 'clamav' })).toThrow(
      /STORAGE_DRIVER/,
    );
    const s3 = {
      ...prod,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'b',
      S3_ACCESS_KEY: 'k',
      S3_SECRET_KEY: 's',
    };
    expect(() => loadEnv({ ...s3, SCAN_PROVIDER: 'disabled' })).toThrow(/SCAN_PROVIDER/);
    expect(() => loadEnv({ ...s3, SCAN_PROVIDER: 'clamav' })).not.toThrow();
    expect(() => loadEnv({ ...prod, STORAGE_DRIVER: 's3', SCAN_PROVIDER: 'clamav' })).toThrow(
      /S3_BUCKET/,
    );
  });

  it('refuses weak or reused secrets and insecure web settings in production', () => {
    const prod = {
      ...base,
      SESSION_SECRET: 'k9Qw3vT7nXz2LpA8sDf6HgJ4mBc1RyUe',
      MFA_ENCRYPTION_KEY: 'R7vU2yTq0nWk5bHx9ZsJ4dGc8LmPe1Af',
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'b',
      S3_ACCESS_KEY: 'k',
      S3_SECRET_KEY: 's',
      CORS_ORIGINS: 'https://app.example.com',
    };
    expect(() => loadEnv(prod)).not.toThrow();
    expect(() =>
      loadEnv({ ...prod, SESSION_SECRET: 'change-me-min-32-chars-change-me-min-32' }),
    ).toThrow(/SESSION_SECRET.*placeholder/s);
    expect(() => loadEnv({ ...prod, MFA_ENCRYPTION_KEY: prod.SESSION_SECRET })).toThrow(
      /must differ/i,
    );
    expect(() => loadEnv({ ...prod, SESSION_SECRET: 'a'.repeat(40) })).toThrow(/SESSION_SECRET/);
    expect(() => loadEnv({ ...prod, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadEnv({ ...prod, CORS_ORIGINS: 'http://app.example.com' })).toThrow(/https/);
    expect(() => loadEnv({ ...prod, CORS_ORIGINS: '*' })).toThrow(/https/);
    expect(() => loadEnv({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/Secure/);
    // The same values are fine in development, where convenience matters.
    expect(() =>
      loadEnv({ ...base, SESSION_SECRET: 'change-me-min-32-chars-change-me-min-32' }),
    ).not.toThrow();
  });
  it('never echoes a rejected secret', () => {
    try {
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        SESSION_SECRET: 'change-me-min-32-chars-change-me-min-32',
      });
    } catch (e) {
      expect(String(e)).not.toContain('change-me-min-32-chars');
    }
  });
});
