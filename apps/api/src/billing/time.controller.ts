import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createTimeEntrySchema,
  timeListQuerySchema,
  updateTimeEntrySchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Idempotent, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { TimeService } from './time.service';

@Controller('time-entries')
export class TimeController {
  constructor(private readonly time: TimeService) {}

  @RequirePermissions('time:write')
  @Idempotent({ optional: true })
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createTimeEntrySchema)) body: z.infer<typeof createTimeEntrySchema>,
    @Req() req: AppRequest,
  ) {
    return this.time.create(auth, body, req);
  }

  // Reads: anyone who can log time sees their own; billing:read sees everyone's.
  @RequirePermissions('matter:read')
  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(timeListQuerySchema)) q: z.infer<typeof timeListQuerySchema>,
    @Req() req: AppRequest,
  ) {
    return this.time.list(auth, q, req);
  }

  @RequirePermissions('matter:read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.time.get(auth, id, req);
  }

  @RequirePermissions('matter:read')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(updateTimeEntrySchema)) body: z.infer<typeof updateTimeEntrySchema>,
    @Req() req: AppRequest,
  ) {
    return this.time.update(auth, id, body, req);
  }

  @RequirePermissions('matter:read')
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    await this.time.remove(auth, id, req);
  }
}
