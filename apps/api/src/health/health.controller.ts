import { Controller, Get, HttpException, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { isDatabaseReady, mongoose } from '@assar/database';
import type { JobQueues } from '@assar/jobs';
import { Public } from '../common/decorators';
import { QUEUES } from '../queue/queue.module';

@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(@Inject(QUEUES) private readonly queues: JobQueues) {}

  /** Liveness: the process is up. */
  @Get('healthz')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies are reachable. */
  @Get('readyz')
  async ready() {
    const checks = { mongodb: 'failing', redis: 'failing' };
    try {
      if (isDatabaseReady()) {
        await mongoose.connection.db?.admin().ping();
        checks.mongodb = 'ok';
      }
    } catch {
      /* reported below */
    }
    try {
      await this.queues.ping();
      checks.redis = 'ok';
    } catch {
      /* reported below */
    }
    if (Object.values(checks).some((c) => c !== 'ok')) {
      throw new HttpException({ status: 'not_ready', checks }, 503);
    }
    return { status: 'ready', checks };
  }
}
