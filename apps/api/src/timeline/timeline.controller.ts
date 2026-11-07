import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { z } from 'zod';
import { timelineQuerySchema } from '@assar/validation';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { TimelineService } from './timeline.service';

@Controller()
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @RequirePermissions('matter:read')
  @Get('matters/:id/timeline')
  matter(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Query(new ZodPipe(timelineQuerySchema)) q: z.infer<typeof timelineQuerySchema>,
    @Req() req: AppRequest,
  ) {
    return this.timeline.forMatter(auth, id, q, req);
  }

  @RequirePermissions('client:read', 'matter:read')
  @Get('clients/:id/timeline')
  client(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Query(new ZodPipe(timelineQuerySchema)) q: z.infer<typeof timelineQuerySchema>,
  ) {
    return this.timeline.forClient(auth, id, q);
  }
}
