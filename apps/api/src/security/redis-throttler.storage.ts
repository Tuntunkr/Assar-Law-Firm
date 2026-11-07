import type { OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { Redis } from 'ioredis';
import type { Logger } from '../common/logger';

// One atomic round trip: count the hit, start the window on the first hit, and (re)heal a key that somehow lost its TTL.
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`;

/**
 * Rate-limit counters in Redis, so limits hold across every API replica (the default in-memory store counts
 * per process, which lets an attacker multiply their allowance by the number of replicas).
 *
 * If Redis is unreachable this FAILS OPEN: requests are allowed (and a warning is logged at most once a
 * minute). Rate limiting is an abuse control; refusing all traffic because the counter store is down would
 * turn a Redis outage into a full outage. Authentication and authorization do not depend on it.
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly redis: Redis;
  private lastWarn = 0;

  constructor(
    redisUrl: string,
    private readonly keyPrefix: string,
    private readonly logger?: Logger,
  ) {
    this.redis = new Redis(redisUrl, {
      // Commands wait briefly for the connection (so the first requests after startup are counted), but never
      // longer than the timeout: if Redis is down we give up quickly and fail open.
      commandTimeout: 500,
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', () => undefined); // surfaced through increment() failures
    this.redis.defineCommand('rlIncrement', { numberOfKeys: 1, lua: INCREMENT });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const [hits, pttl] = (await (
        this.redis as unknown as { rlIncrement(k: string, ttl: number): Promise<[number, number]> }
      ).rlIncrement(`${this.keyPrefix}:rl:${throttlerName}:${key}`, ttl)) as [number, number];
      const timeToExpire = Math.max(1, Math.ceil(pttl / 1000));
      const blocked = hits > limit;
      return {
        totalHits: hits,
        timeToExpire,
        isBlocked: blocked,
        timeToBlockExpire: blocked ? timeToExpire : 0,
      };
    } catch (err) {
      const now = Date.now();
      if (now - this.lastWarn > 60_000) {
        this.lastWarn = now;
        this.logger?.warn(
          { err: (err as Error).message },
          'rate-limit store unavailable; allowing requests (fail-open)',
        );
      }
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}
