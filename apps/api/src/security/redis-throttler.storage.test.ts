import { afterAll, describe, expect, it } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler.storage';

const URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380';
const stores: RedisThrottlerStorage[] = [];
const make = (prefix: string, logger?: { warn: (o: object, m?: string) => void }) => {
  const s = new RedisThrottlerStorage(URL, prefix, logger as never);
  stores.push(s);
  return s;
};
const uniq = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
afterAll(async () => {
  await Promise.all(stores.map((s) => s.onModuleDestroy()));
});

describe('RedisThrottlerStorage', () => {
  it('counts hits in a window and reports when the limit is exceeded', async () => {
    const s = make(uniq());
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await s.increment('user:1', 60_000, 3, 0, 'principal'));
    expect(hits.map((h) => h.totalHits)).toEqual([1, 2, 3, 4]);
    expect(hits.map((h) => h.isBlocked)).toEqual([false, false, false, true]);
    expect(hits[3]!.timeToExpire).toBeGreaterThan(0);
    expect(hits[3]!.timeToExpire).toBeLessThanOrEqual(60);
  });

  it('shares counters between instances, which is what makes limits hold across API replicas', async () => {
    const prefix = uniq();
    const a = make(prefix);
    const b = make(prefix);
    await a.increment('ip:1.2.3.4', 60_000, 5, 0, 'default');
    await b.increment('ip:1.2.3.4', 60_000, 5, 0, 'default');
    expect((await a.increment('ip:1.2.3.4', 60_000, 5, 0, 'default')).totalHits).toBe(3);
  });

  it('isolates keys by caller, limiter name and prefix', async () => {
    const prefix = uniq();
    const s = make(prefix);
    await s.increment('u:1', 60_000, 5, 0, 'principal');
    await s.increment('u:1', 60_000, 5, 0, 'principal');
    expect((await s.increment('u:2', 60_000, 5, 0, 'principal')).totalHits).toBe(1);
    expect((await s.increment('u:1', 60_000, 5, 0, 'report-export')).totalHits).toBe(1);
    expect((await make(uniq()).increment('u:1', 60_000, 5, 0, 'principal')).totalHits).toBe(1);
  });

  it('is atomic under concurrency: no hit is lost or double counted', async () => {
    const s = make(uniq());
    const results = await Promise.all(
      Array.from({ length: 50 }, () => s.increment('burst', 60_000, 10, 0, 'principal')),
    );
    expect(results.map((r) => r.totalHits).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    expect(results.filter((r) => !r.isBlocked)).toHaveLength(10);
  });

  it('starts a new window after the old one expires', async () => {
    const s = make(uniq());
    await s.increment('k', 300, 2, 0, 'principal');
    await s.increment('k', 300, 2, 0, 'principal');
    expect((await s.increment('k', 300, 2, 0, 'principal')).isBlocked).toBe(true);
    await new Promise((r) => setTimeout(r, 450));
    expect((await s.increment('k', 300, 2, 0, 'principal')).totalHits).toBe(1);
  });

  it('fails open, and warns once, when Redis is unreachable', async () => {
    const warnings: string[] = [];
    const s = new RedisThrottlerStorage('redis://127.0.0.1:1', uniq(), {
      warn: (_o: object, m?: string) => warnings.push(m ?? ''),
    } as never);
    stores.push(s);
    for (let i = 0; i < 3; i++) {
      const r = await s.increment('k', 60_000, 1, 0, 'principal');
      expect(r).toMatchObject({ totalHits: 1, isBlocked: false });
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/fail-open/);
  });
});
