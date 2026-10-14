import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env.js';

const base = {
  MONGODB_URI: 'mongodb://127.0.0.1:27117/x',
  REDIS_URL: 'redis://127.0.0.1:6380',
  SESSION_SECRET: 's'.repeat(32),
};

describe('loadWorkerEnv', () => {
  it('applies safe defaults and runs without AI when no key is set', () => {
    const env = loadWorkerEnv(base);
    expect(env.GROK_API_KEY).toBeUndefined();
    expect(env.WORKER_HEALTH_HOST).toBe('127.0.0.1');
    expect(env.SCAN_PROVIDER).toBe('clamav');
  });

  it('never assumes a model: a key without GROK_MODEL is an error', () => {
    expect(() => loadWorkerEnv({ ...base, GROK_API_KEY: 'k' })).toThrow(/GROK_MODEL/);
    expect(loadWorkerEnv({ ...base, GROK_API_KEY: 'k', GROK_MODEL: 'some-model' }).GROK_MODEL).toBe(
      'some-model',
    );
  });

  it('refuses unsafe production settings', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => loadWorkerEnv({ ...prod, SCAN_PROVIDER: 'clamav' })).toThrow(/STORAGE_DRIVER/);
    const s3 = {
      ...prod,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'b',
      S3_ACCESS_KEY: 'k',
      S3_SECRET_KEY: 's',
    };
    expect(() => loadWorkerEnv({ ...s3, SCAN_PROVIDER: 'disabled' })).toThrow(/SCAN_PROVIDER/);
    expect(() => loadWorkerEnv({ ...s3, SCAN_PROVIDER: 'clamav' })).not.toThrow();
  });

  it('requires connection settings and does not echo secrets in errors', () => {
    expect(() => loadWorkerEnv({ MONGODB_URI: 'x' })).toThrow(/REDIS_URL/);
    try {
      loadWorkerEnv({ ...base, GROK_API_KEY: 'super-secret-key' });
    } catch (e) {
      expect(String(e)).not.toContain('super-secret-key');
    }
  });
});
