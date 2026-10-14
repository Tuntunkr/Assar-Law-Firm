import { Redis } from 'ioredis';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
}

/** `redis://[user:pass@]host:port[/db]` (or `rediss://` for TLS) → connection options. */
export function parseRedisUrl(url: string): RedisConnectionOptions {
  const u = new URL(url);
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:')
    throw new Error('REDIS_URL must start with redis:// or rediss://');
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

/** A plain client for heartbeats and health checks (BullMQ manages its own connections). */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false });
}
