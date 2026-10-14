import { Controller, Get, Inject, type OnModuleDestroy } from '@nestjs/common';
import { createRedis, readHeartbeats, type JobQueues } from '@assar/jobs';
import type { Redis } from 'ioredis';
import { RequirePermissions } from '../common/decorators';
import { ENV, type Env } from '../config/env';
import { QUEUES } from '../queue/queue.module';

/** Observability for background processing. Reports platform liveness, not any tenant's data. */
@Controller('system')
export class SystemController implements OnModuleDestroy {
  private redis?: Redis;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(QUEUES) private readonly queues: JobQueues,
  ) {}

  @RequirePermissions('org:manage')
  @Get('workers')
  async workers() {
    this.redis ??= createRedis(this.env.REDIS_URL);
    const [workers, queues] = await Promise.all([
      readHeartbeats(this.redis, this.env.QUEUE_PREFIX),
      this.queues.counts(),
    ]);
    return {
      aiEnabled: this.env.AI_ENABLED,
      /** True when at least one worker has reported in recently (heartbeats expire in ~20s). */
      healthy: workers.length > 0,
      workers,
      queues,
    };
  }

  async onModuleDestroy() {
    this.redis?.disconnect();
  }
}
