import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { billingSettings, hasBillingData } from '@assar/database';
import { billingSettingsSchema, memberRateSchema } from '@assar/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RequirePermissions } from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { loadBilling } from './billing-common';

@Controller('billing')
export class BillingSettingsController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermissions('billing:read')
  @Get('settings')
  async get(@Auth() auth: AuthContext) {
    const settings = await loadBilling(auth.organizationId);
    return {
      ...settings,
      policy: {
        tax: 'explicit_rate_only' as const,
        collection: 'manual_only' as const,
        gst: 'not_determined' as const,
      },
    };
  }

  @RequirePermissions('billing:write')
  @Put('settings')
  async set(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(billingSettingsSchema)) body: z.infer<typeof billingSettingsSchema>,
    @Req() req: AppRequest,
  ) {
    const current = await loadBilling(auth.organizationId);
    // Amounts are stored in one currency per firm; switching after money exists would silently mix currencies.
    if (body.currency !== current.currency && (await hasBillingData(auth.organizationId))) {
      throw new ApiError(
        409,
        'CONFLICT',
        'The currency can only be changed before any time entries or invoices exist',
      );
    }
    await billingSettings.set(auth.organizationId, body);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'billing.settings_updated',
      req,
      meta: {
        currency: body.currency,
        defaultTaxRateBp: body.defaultTaxRateBp,
        invoiceDueDays: body.invoiceDueDays,
        reminderSteps: body.reminderDays?.length ?? null,
      },
    });
    return loadBilling(auth.organizationId);
  }

  /** A person's own default rate. Applies to time logged from now on; existing entries keep their rate. */
  @RequirePermissions('billing:write')
  @Put('members/:userId/rate')
  async setRate(
    @Auth() auth: AuthContext,
    @Param('userId', ObjectIdPipe) userId: string,
    @Body(new ZodPipe(memberRateSchema)) body: z.infer<typeof memberRateSchema>,
    @Req() req: AppRequest,
  ) {
    const m = await billingSettings.setMemberRate(
      auth.organizationId,
      userId,
      body.hourlyRateCents,
    );
    if (!m) throw new ApiError(404, 'NOT_FOUND', 'Member not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'billing.member_rate_set',
      targetType: 'user',
      targetId: userId,
      req,
    });
    return { userId, hourlyRateCents: m.hourlyRateCents ?? null };
  }
}
