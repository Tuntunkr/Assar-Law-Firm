import { Injectable } from '@nestjs/common';
import { billingSettings, clients, timeEntries, type TimeEntryDoc } from '@assar/database';
import { hasPermission, timeAmountCents } from '@assar/types';
import type { z } from 'zod';
import type {
  createTimeEntrySchema,
  timeListQuerySchema,
  updateTimeEntrySchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { MatterAccessService } from '../matters/matter-access.service';
import { idStr, isFutureDate, loadBilling } from './billing-common';

type Req = Pick<AppRequest, 'ip' | 'id'>;

export const timeEntryDto = (t: TimeEntryDoc) => ({
  id: String(t._id),
  matterId: String(t.matterId),
  clientId: String(t.clientId),
  userId: String(t.userId),
  workDate: t.workDate.toISOString().slice(0, 10),
  minutes: t.minutes,
  description: t.description,
  billable: t.billable,
  rateCents: t.rateCents,
  currency: t.currency,
  amountCents: t.amountCents,
  status: t.status,
  invoiceId: idStr(t.invoiceId),
  createdAt: t.createdAt,
});

@Injectable()
export class TimeService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
  ) {}

  /** Rate in force now: explicit override (billing:write) > the person's rate > the firm default. */
  private async resolveRate(auth: AuthContext, explicit: number | undefined, billable: boolean) {
    if (explicit !== undefined) {
      if (!hasPermission(auth.role, 'billing:write'))
        throw new ApiError(403, 'FORBIDDEN', 'Only billing managers can set a custom rate');
      return explicit;
    }
    const rate =
      (await billingSettings.rateFor(auth.organizationId, auth.userId)) ??
      (await loadBilling(auth.organizationId)).defaultHourlyRateCents;
    if (rate === null) {
      if (!billable) return 0;
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'No hourly rate is configured for you or the firm. Ask a billing manager to set one.',
      );
    }
    return rate;
  }

  async create(auth: AuthContext, input: z.infer<typeof createTimeEntrySchema>, req: Req) {
    if (isFutureDate(input.workDate))
      throw new ApiError(400, 'VALIDATION_FAILED', 'Work date cannot be in the future');
    const matter = await this.access.load(auth, input.matterId, req);
    const rateCents = await this.resolveRate(auth, input.rateCents, input.billable);
    const { currency } = await loadBilling(auth.organizationId);
    const t = await timeEntries.create({
      organizationId: auth.organizationId as never,
      matterId: matter._id,
      clientId: matter.clientId,
      userId: auth.userId as never,
      workDate: input.workDate,
      minutes: input.minutes,
      description: input.description,
      billable: input.billable,
      rateCents,
      currency,
      amountCents: input.billable ? timeAmountCents(input.minutes, rateCents) : 0,
      createdBy: auth.userId as never,
    });
    // Metadata only: the description is confidential and stays out of the audit log.
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'time.created',
      targetType: 'time_entry',
      targetId: String(t._id),
      req,
      meta: { matterId: input.matterId, minutes: t.minutes, billable: t.billable },
    });
    return timeEntryDto(t);
  }

  /** Everyone sees their own time; seeing other people's needs billing:read. Restricted matters stay hidden. */
  private canSeeOthers = (auth: AuthContext) => hasPermission(auth.role, 'billing:read');

  async list(auth: AuthContext, q: z.infer<typeof timeListQuerySchema>, req: Req) {
    if (!this.canSeeOthers(auth) && q.userId && q.userId !== auth.userId) {
      throw new ApiError(403, 'FORBIDDEN', 'You can only see your own time entries');
    }
    if (q.matterId) await this.access.load(auth, q.matterId, req);
    const hiddenMatterIds = q.matterId ? [] : await this.access.hiddenMatterIds(auth);
    const page = await timeEntries.listPage(auth.organizationId, {
      ...q,
      userId: this.canSeeOthers(auth) ? q.userId : auth.userId,
      hiddenMatterIds,
    });
    return { data: page.data.map(timeEntryDto), page: page.page };
  }

  private async load(auth: AuthContext, id: string, req: Req, write: boolean) {
    if (
      write &&
      !hasPermission(auth.role, 'time:write') &&
      !hasPermission(auth.role, 'billing:write')
    ) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to change time entries');
    }
    const t = await timeEntries.findById(auth.organizationId, id);
    const mine = t && String(t.userId) === auth.userId;
    const allowed =
      t && (mine || (write ? hasPermission(auth.role, 'billing:write') : this.canSeeOthers(auth)));
    if (!t || !allowed) throw new ApiError(404, 'NOT_FOUND', 'Time entry not found');
    await this.access.loadFor(auth, String(t.matterId), req, 'Time entry not found');
    return t;
  }

  async get(auth: AuthContext, id: string, req: Req) {
    return timeEntryDto(await this.load(auth, id, req, false));
  }

  async update(
    auth: AuthContext,
    id: string,
    patch: z.infer<typeof updateTimeEntrySchema>,
    req: Req,
  ) {
    const cur = await this.load(auth, id, req, true);
    if (cur.status !== 'unbilled')
      throw new ApiError(409, 'CONFLICT', 'Entries on an invoice cannot be changed');
    if (patch.workDate && isFutureDate(patch.workDate))
      throw new ApiError(400, 'VALIDATION_FAILED', 'Work date cannot be in the future');
    if (patch.rateCents !== undefined && !hasPermission(auth.role, 'billing:write')) {
      throw new ApiError(403, 'FORBIDDEN', 'Only billing managers can set a custom rate');
    }

    const set: Record<string, unknown> = { ...patch };
    if (patch.matterId && patch.matterId !== String(cur.matterId)) {
      const m = await this.access.load(auth, patch.matterId, req);
      set.clientId = m.clientId;
    }
    const minutes = patch.minutes ?? cur.minutes;
    const rateCents = patch.rateCents ?? cur.rateCents;
    const billable = patch.billable ?? cur.billable;
    set.amountCents = billable ? timeAmountCents(minutes, rateCents) : 0;
    // The rate is a snapshot: re-pricing a non-billable entry that becomes billable uses today's rate.
    if (patch.billable === true && !cur.billable && patch.rateCents === undefined) {
      const owner = String(cur.userId);
      const rate =
        (await billingSettings.rateFor(auth.organizationId, owner)) ??
        (await loadBilling(auth.organizationId)).defaultHourlyRateCents;
      if (rate === null)
        throw new ApiError(400, 'VALIDATION_FAILED', 'No hourly rate is configured');
      set.rateCents = rate;
      set.amountCents = timeAmountCents(minutes, rate);
    }

    const updated = await timeEntries.updateUnbilled(auth.organizationId, id, set);
    if (!updated) throw new ApiError(409, 'CONFLICT', 'Entries on an invoice cannot be changed');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'time.updated',
      targetType: 'time_entry',
      targetId: id,
      req,
      meta: { fields: Object.keys(patch) },
    });
    return timeEntryDto(updated);
  }

  async remove(auth: AuthContext, id: string, req: Req) {
    const cur = await this.load(auth, id, req, true);
    if (cur.status !== 'unbilled')
      throw new ApiError(409, 'CONFLICT', 'Entries on an invoice cannot be deleted');
    if ((await timeEntries.deleteUnbilled(auth.organizationId, id)).deletedCount !== 1) {
      throw new ApiError(409, 'CONFLICT', 'Entries on an invoice cannot be deleted');
    }
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'time.deleted',
      targetType: 'time_entry',
      targetId: id,
      req,
      meta: { minutes: cur.minutes },
    });
  }

  /** Used by settings: a client must exist to be billed. */
  clientExists(orgId: string, id: string) {
    return clients.findById(orgId, id);
  }
}
