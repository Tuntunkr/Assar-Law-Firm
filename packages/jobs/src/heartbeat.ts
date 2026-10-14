import type { Redis } from 'ioredis';

export interface Heartbeat {
  workerId: string;
  host: string;
  pid: number;
  startedAt: string;
  lastBeat: string;
  [k: string]: unknown;
}

const key = (prefix: string, id: string) => `${prefix}:assar:heartbeat:${id}`;

/** Publishes liveness (and counters) to Redis with a TTL, so a dead worker disappears by itself. */
export function startHeartbeat(o: {
  redis: Redis;
  prefix: string;
  workerId: string;
  host: string;
  intervalMs?: number;
  ttlSeconds?: number;
  snapshot: () => Record<string, unknown>;
}) {
  const startedAt = new Date().toISOString();
  const beat = async () => {
    const hb: Heartbeat = {
      workerId: o.workerId,
      host: o.host,
      pid: process.pid,
      startedAt,
      lastBeat: new Date().toISOString(),
      ...o.snapshot(),
    };
    await o.redis.set(key(o.prefix, o.workerId), JSON.stringify(hb), 'EX', o.ttlSeconds ?? 20);
  };
  void beat().catch(() => undefined);
  const timer = setInterval(() => void beat().catch(() => undefined), o.intervalMs ?? 5000);
  return {
    async stop() {
      clearInterval(timer);
      await o.redis.del(key(o.prefix, o.workerId)).catch(() => undefined);
    },
  };
}

export async function readHeartbeats(redis: Redis, prefix: string): Promise<Heartbeat[]> {
  const found: string[] = [];
  for await (const keys of redis.scanStream({ match: `${prefix}:assar:heartbeat:*`, count: 100 }))
    found.push(...(keys as string[]));
  if (found.length === 0) return [];
  const values = await redis.mget(...found);
  return values.filter((v): v is string => !!v).map((v) => JSON.parse(v) as Heartbeat);
}
