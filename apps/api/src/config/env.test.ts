import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

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
    const prod = { ...base, NODE_ENV: 'production' };
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
});
