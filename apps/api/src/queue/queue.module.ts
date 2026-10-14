import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { JobQueues } from '@assar/jobs';
import { ENV, type Env } from '../config/env';

export const QUEUES = Symbol('QUEUES');

/** Producer-side queue access. Jobs are processed by apps/worker, never inside the API. */
@Global()
@Module({
  providers: [
    {
      provide: QUEUES,
      inject: [ENV],
      useFactory: (env: Env) =>
        new JobQueues({
          redisUrl: env.REDIS_URL,
          prefix: env.QUEUE_PREFIX,
          scanAttempts: env.SCAN_JOB_MAX_ATTEMPTS,
          backoffDelayMs: env.JOB_BACKOFF_MS,
        }),
    },
  ],
  exports: [QUEUES],
})
export class QueueModule implements OnModuleDestroy {
  constructor(@Inject(QUEUES) private readonly queues: JobQueues) {}
  async onModuleDestroy() {
    await this.queues.close();
  }
}
