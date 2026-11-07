import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  createDeadlineSchema,
  outboxDraftSchema,
  updateDeadlineSchema,
  webhookAckSchema,
} from '@assar/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Idempotent, Public, RequirePermissions } from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import { hmac, safeEqual } from '../common/crypto';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, type Env } from '../config/env';
import { PracticeService } from './practice.service';

@Controller()
export class PracticeController {
  constructor(
    private readonly practice: PracticeService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @RequirePermissions('matter:read')
  @Get('courts/provider')
  provider() {
    return this.practice.provider();
  }

  @RequirePermissions('matter:read')
  @Get('deadlines')
  deadlines(@Auth() auth: AuthContext) {
    return this.practice.listDeadlines(auth);
  }

  @RequirePermissions('matter:write')
  @Idempotent({ optional: true })
  @Post('deadlines')
  createDeadline(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createDeadlineSchema)) body: z.infer<typeof createDeadlineSchema>,
    @Req() req: AppRequest,
  ) {
    return this.practice.createDeadline(auth, body, req);
  }

  @RequirePermissions('matter:write')
  @Patch('deadlines/:id')
  updateDeadline(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(updateDeadlineSchema)) body: z.infer<typeof updateDeadlineSchema>,
    @Req() req: AppRequest,
  ) {
    return this.practice.updateDeadline(auth, id, body, req);
  }

  @RequirePermissions('matter:write')
  @Post('deadlines/:id/submit')
  submit(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.practice.transition(auth, id, 'submit', req);
  }

  @RequirePermissions('deadline:approve')
  @Post('deadlines/:id/approve')
  approve(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.practice.transition(auth, id, 'approve', req);
  }

  @RequirePermissions('deadline:approve')
  @Post('deadlines/:id/reject')
  reject(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.practice.transition(auth, id, 'reject', req);
  }

  @RequirePermissions('deadline:approve')
  @Post('deadlines/:id/close')
  close(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.practice.transition(auth, id, 'close', req);
  }

  @RequirePermissions('deadline:approve')
  @Post('deadlines/reminders/run')
  run(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    return this.practice.runReminders(auth, req);
  }

  @RequirePermissions('matter:read')
  @Get('outbox')
  outbox(@Auth() auth: AuthContext) {
    return this.practice.listOutbox(auth);
  }

  @RequirePermissions('matter:write')
  @Idempotent({ optional: true })
  @Post('outbox')
  draft(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(outboxDraftSchema)) body: z.infer<typeof outboxDraftSchema>,
    @Req() req: AppRequest,
  ) {
    return this.practice.draftOutbox(auth, body, req);
  }

  @RequirePermissions('message:approve')
  @Post('outbox/:id/approve')
  approveMessage(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.practice.decideOutbox(auth, id, true, req);
  }

  @RequirePermissions('message:approve')
  @Post('outbox/:id/reject')
  rejectMessage(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.practice.decideOutbox(auth, id, false, req);
  }

  /** Mock provider callback. A missing secret is an activation gate, not an open endpoint. */
  @Public()
  @Post('webhooks/messages/mock')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Body(new ZodPipe(webhookAckSchema)) body: z.infer<typeof webhookAckSchema>,
    @Req() req: AppRequest,
  ) {
    const secret = this.env.MESSAGE_WEBHOOK_SECRET;
    if (!secret)
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'External activation gate: the message webhook secret is not configured',
      );
    const timestamp = String(req.header('x-assar-timestamp') ?? '');
    const signature = String(req.header('x-assar-signature') ?? '');
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    const expected = `sha256=${hmac(secret, `${timestamp}.${JSON.stringify(body)}`)}`;
    if (!timestamp || !Number.isFinite(age) || age > 300 || !safeEqual(signature, expected))
      throw new ApiError(401, 'UNAUTHENTICATED', 'Webhook signature was rejected');
    const organizationId = String(req.header('x-assar-organization') ?? '');
    if (!organizationId)
      throw new ApiError(400, 'VALIDATION_FAILED', 'x-assar-organization is required');
    const result = await this.practice.ackMock(organizationId, body.outboxId, body.eventId);
    await this.audit.record({
      organizationId,
      actorType: 'system',
      action: 'outbox.webhook',
      targetType: 'outbox',
      targetId: body.outboxId,
      req,
      meta: { replayed: result.replayed },
    });
    return result;
  }
}
