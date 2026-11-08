import { Body, Controller, Get, HttpCode, Post, Param, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  courtFormDraftSchema,
  courtFormSignoffSchema,
  courtImportBatchSchema,
  demoBookingSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Public, RequirePermissions } from '../common/decorators';
import { AUTH_THROTTLE } from '../common/rate-limits';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { ActivationService } from './activation.service';

@Controller()
export class ActivationController {
  constructor(private readonly activation: ActivationService) {}

  @RequirePermissions('matter:read')
  @Get('courts/feed')
  feed() {
    return this.activation.courtFeed();
  }

  @RequirePermissions('matter:read')
  @Get('courts/imports')
  imports(@Auth() auth: AuthContext) {
    return this.activation.listImports(auth);
  }

  @RequirePermissions('matter:write')
  @Post('courts/imports')
  importRows(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(courtImportBatchSchema)) body: z.infer<typeof courtImportBatchSchema>,
    @Req() req: AppRequest,
  ) {
    return this.activation.importCauseList(auth, body, req);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Get('demo-bookings/slots')
  slots() {
    return this.activation.slots();
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('demo-bookings')
  book(@Body(new ZodPipe(demoBookingSchema)) body: z.infer<typeof demoBookingSchema>) {
    return this.activation.book(body);
  }

  @RequirePermissions('matter:read')
  @Get('court-forms')
  forms(@Auth() auth: AuthContext) {
    return this.activation.listForms(auth);
  }

  @RequirePermissions('matter:write')
  @Post('court-forms')
  draft(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(courtFormDraftSchema)) body: z.infer<typeof courtFormDraftSchema>,
    @Req() req: AppRequest,
  ) {
    return this.activation.createForm(auth, body, req);
  }

  @RequirePermissions('form:approve')
  @HttpCode(200)
  @Post('court-forms/:id/signoff')
  sign(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(courtFormSignoffSchema)) body: z.infer<typeof courtFormSignoffSchema>,
    @Req() req: AppRequest,
  ) {
    return this.activation.signForm(auth, id, body, req);
  }

  @RequirePermissions('matter:read')
  @Get('mailbox')
  mailbox(@Auth() auth: AuthContext) {
    return this.activation.listMailbox(auth);
  }
}
