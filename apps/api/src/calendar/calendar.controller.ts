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
import { createEventSchema, eventListQuerySchema, updateEventSchema } from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { CalendarService } from './calendar.service';

@Controller('calendar/events')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @RequirePermissions('calendar:write')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createEventSchema)) body: z.infer<typeof createEventSchema>,
    @Req() req: AppRequest,
  ) {
    return this.calendar.create(auth, body, req);
  }

  @RequirePermissions('matter:read')
  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(eventListQuerySchema)) q: z.infer<typeof eventListQuerySchema>,
    @Req() req: AppRequest,
  ) {
    return this.calendar.list(auth, q, req);
  }

  @RequirePermissions('matter:read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.calendar.get(auth, id, req);
  }

  @RequirePermissions('calendar:write')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(updateEventSchema)) body: z.infer<typeof updateEventSchema>,
    @Req() req: AppRequest,
  ) {
    return this.calendar.update(auth, id, body, req);
  }

  @RequirePermissions('calendar:write')
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    await this.calendar.remove(auth, id, req);
  }
}
