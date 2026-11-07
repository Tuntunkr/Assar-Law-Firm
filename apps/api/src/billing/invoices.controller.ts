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
  addInvoiceLineSchema,
  createInvoiceSchema,
  invoiceListQuerySchema,
  logInvoiceReminderSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Idempotent, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @RequirePermissions('billing:write')
  @Idempotent({ optional: true })
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createInvoiceSchema)) body: z.infer<typeof createInvoiceSchema>,
    @Req() req: AppRequest,
  ) {
    return this.invoices.create(auth, body, req);
  }

  @RequirePermissions('billing:read')
  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(invoiceListQuerySchema)) q: z.infer<typeof invoiceListQuerySchema>,
  ) {
    return this.invoices.list(auth, q);
  }

  /** Declared before `:id` routes. Checks the whole firm for invoices that have reached a reminder step. */
  @RequirePermissions('billing:write')
  @HttpCode(200)
  @Post('reminders/run')
  runReminders(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    return this.invoices.runReminders(auth, req);
  }

  @RequirePermissions('billing:read')
  @Get(':id/reminder-draft')
  reminderDraft(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.invoices.reminderDraft(auth, id, req);
  }

  @RequirePermissions('billing:write')
  @Post(':id/reminders')
  logReminder(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(logInvoiceReminderSchema)) body: z.infer<typeof logInvoiceReminderSchema>,
    @Req() req: AppRequest,
  ) {
    return this.invoices.logReminder(auth, id, body, req);
  }

  @RequirePermissions('billing:read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.invoices.get(auth, id, req);
  }

  @RequirePermissions('billing:write')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(updateInvoiceSchema)) body: z.infer<typeof updateInvoiceSchema>,
    @Req() req: AppRequest,
  ) {
    return this.invoices.update(auth, id, body, req);
  }

  @RequirePermissions('billing:write')
  @HttpCode(204)
  @Delete(':id')
  async deleteDraft(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    await this.invoices.deleteDraft(auth, id, req);
  }

  @RequirePermissions('billing:write')
  @Post(':id/lines')
  addLine(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(addInvoiceLineSchema)) body: z.infer<typeof addInvoiceLineSchema>,
    @Req() req: AppRequest,
  ) {
    return this.invoices.addLine(auth, id, body, req);
  }

  @RequirePermissions('billing:write')
  @Delete(':id/lines/:lineId')
  removeLine(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('lineId', ObjectIdPipe) lineId: string,
    @Req() req: AppRequest,
  ) {
    return this.invoices.removeLine(auth, id, lineId, req);
  }

  @RequirePermissions('billing:write')
  @HttpCode(200)
  @Post(':id/issue')
  issue(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.invoices.issue(auth, id, req);
  }

  /** Recording money is a critical operation: an Idempotency-Key is required so a retry can't count twice. */
  @RequirePermissions('billing:write')
  @Idempotent()
  @Post(':id/payments')
  pay(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(recordPaymentSchema)) body: z.infer<typeof recordPaymentSchema>,
    @Req() req: AppRequest,
  ) {
    return this.invoices.recordPayment(auth, id, body, req);
  }

  @RequirePermissions('billing:write')
  @HttpCode(200)
  @Post(':id/void')
  void(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(voidInvoiceSchema)) body: z.infer<typeof voidInvoiceSchema>,
    @Req() req: AppRequest,
  ) {
    return this.invoices.void(auth, id, body.reason, req);
  }
}
