import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
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

  /**
   * Readiness: dependencies are reachable.
   * The body is written here. The global error filter replaces 5xx HttpException
   * payloads, which would hide which dependency failed.
   */
  @Get('readyz')
  async ready(@Res() res: Response) {
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
    const ready = Object.values(checks).every((c) => c === 'ok');
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
  }
}
