import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  automationNotificationSchema,
  automationTaskSchema,
  remindersQuerySchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, ServiceContext } from '../common/auth-context';
import { Idempotent, Service, ServiceAccess } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { AutomationService } from './automation.service';

/** The only endpoints an automation token can reach. Each declares the scope it needs. */
@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @ServiceAccess('reminders:read')
  @Get('reminders/due')
  due(
    @Service() s: ServiceContext,
    @Query(new ZodPipe(remindersQuerySchema)) q: z.infer<typeof remindersQuerySchema>,
    @Req() req: AppRequest,
  ) {
    return this.automation.dueReminders(s, q.windowHours, req);
  }

  @ServiceAccess('notifications:write')
  @HttpCode(200)
  @Post('notifications')
  notify(
    @Service() s: ServiceContext,
    @Body(new ZodPipe(automationNotificationSchema))
    body: z.infer<typeof automationNotificationSchema>,
    @Req() req: AppRequest,
  ) {
    return this.automation.notify(s, body, req);
  }

  @ServiceAccess('tasks:write')
  @Idempotent()
  @Post('tasks')
  createTask(
    @Service() s: ServiceContext,
    @Body(new ZodPipe(automationTaskSchema)) body: z.infer<typeof automationTaskSchema>,
    @Req() req: AppRequest,
  ) {
    return this.automation.createTask(s, body, req);
  }

  @ServiceAccess('matters:read')
  @Get('matters/:id/context')
  matterContext(
    @Service() s: ServiceContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.automation.matterContext(s, id, req);
  }

  @ServiceAccess('reports:read')
  @Get('reports/daily')
  report(@Service() s: ServiceContext, @Req() req: AppRequest) {
    return this.automation.dailyReport(s, req);
  }
}
