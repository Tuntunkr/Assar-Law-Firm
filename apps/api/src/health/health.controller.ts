import { Controller, Get, HttpException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { isDatabaseReady, mongoose } from '@assar/database';
import { Public } from '../common/decorators';

@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  /** Liveness: the process is up. */
  @Get('healthz')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies are reachable. */
  @Get('readyz')
  async ready() {
    try {
      if (!isDatabaseReady()) throw new Error('db not connected');
      await mongoose.connection.db?.admin().ping();
      return { status: 'ready', checks: { mongodb: 'ok' } };
    } catch {
      throw new HttpException({ status: 'not_ready', checks: { mongodb: 'failing' } }, 503);
    }
  }
}
