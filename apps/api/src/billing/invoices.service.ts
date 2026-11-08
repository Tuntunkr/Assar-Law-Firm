import { Injectable } from '@nestjs/common';
import {
  clients,
  dispatchInvoiceReminders,
  invoices,
  matters,
  mongoose,
  organizations,
  timeEntries,
  users,
  type InvoiceDoc,
} from '@assar/database';
import { daysPastDue, reminderMessage, reminderStep } from '@assar/types';
import type { z } from 'zod';
import type {
  addInvoiceLineSchema,
  createInvoiceSchema,
  invoiceListQuerySchema,
  logInvoiceReminderSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { MatterAccessService } from '../matters/matter-access.service';
import { computeTotals, idStr, isFutureDate, loadBilling } from './billing-common';

type Req = Pick<AppRequest, 'ip' | 'id'>;
type Invoice = NonNullable<Awaited<ReturnType<typeof invoices.findById>>>;

const lineDto = (l: InvoiceDoc['lines'][number]) => ({
  id: String(l._id),
  type: l.type,
  description: l.description,
  matterId: idStr(l.matterId),
  timeEntryId: idStr(l.timeEntryId),
  minutes: l.minutes ?? null,
  rateCents: l.rateCents ?? null,
  amountCents: l.amountCents,
});

/** Days past the due date for an invoice that still owes money; null when it does not apply. */
const overdueDays = (i: Pick<InvoiceDoc, 'status' | 'dueAt' | 'balanceCents'>) =>
  i.status === 'issued' && i.balanceCents > 0 && i.dueAt ? daysPastDue(i.dueAt) : null;

const summaryDto = (i: Omit<InvoiceDoc, 'lines'> & { lines?: InvoiceDoc['lines'] }) => ({
  id: String(i._id),
  number: i.number ?? null,
  clientId: String(i.clientId),
  status: i.status,
  currency: i.currency,
  subtotalCents: i.subtotalCents,
  taxRateBp: i.taxRateBp,
  taxCents: i.taxCents,
  accountantReviewedAt: i.accountantReviewedAt ?? null,
  totalCents: i.totalCents,
  amountPaidCents: i.amountPaidCents,
  balanceCents: i.balanceCents,
  issuedAt: i.issuedAt ?? null,
  dueAt: i.dueAt ?? null,
  paidAt: i.paidAt ?? null,
  daysPastDue: overdueDays(i),
  createdAt: i.createdAt,
});

const invoiceDto = (i: InvoiceDoc) => ({
  ...summaryDto(i),
  dueDays: i.dueDays,
  notes: i.notes ?? null,
  voidedAt: i.voidedAt ?? null,
  voidReason: i.voidReason ?? null,
  reminders: (i.reminders ?? []).map((r) => ({
    id: String(r._id),
    at: r.at,
    channel: r.channel,
    note: r.note ?? null,
    by: String(r.by),
  })),
  lines: i.lines.map(lineDto),
  payments: i.payments.map((p) => ({
    id: String(p._id),
    amountCents: p.amountCents,
    paidAt: p.paidAt,
    method: p.method,
    reference: p.reference ?? null,
    recordedBy: String(p.recordedBy),
  })),
});

const matterIdsOf = (lines: InvoiceDoc['lines']) => [
  ...new Set(lines.map((l) => idStr(l.matterId)).filter((x): x is string => !!x)),
];

/**
 * Invoices. Rules that matter:
 *  - money is integer cents; totals are recomputed on the server, never trusted from a client;
 *  - a time entry can be on at most one invoice (claimed atomically, all-or-nothing);
 *  - drafts are editable, issued invoices are frozen; numbers are assigned at issue so drafts leave no gaps;
 *  - payments can't exceed the balance even when recorded concurrently;
 *  - an invoice touching a matter the viewer cannot see is invisible to them (404).
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
  ) {}

  private async inTx<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => {
        out = await fn(session);
      });
      return out;
    } finally {
      await session.endSession();
    }
  }

  /** The caller must be able to see every matter the invoice touches. */
  private async assertMattersVisible(
    auth: AuthContext,
    matterIds: string[],
    req: Req,
    notFound: string,
  ) {
    for (const id of matterIds) await this.access.loadFor(auth, id, req, notFound);
  }

  private async load(auth: AuthContext, id: string, req: Req): Promise<Invoice> {
    const inv = await invoices.findById(auth.organizationId, id);
    if (!inv) throw new ApiError(404, 'NOT_FOUND', 'Invoice not found');
    await this.assertMattersVisible(auth, inv.matterIds.map(String), req, 'Invoice not found');
    return inv;
  }

  async create(auth: AuthContext, input: z.infer<typeof createInvoiceSchema>, req: Req) {
    const orgId = auth.organizationId;
    const client = await clients.findById(orgId, input.clientId);
    if (!client) throw new ApiError(404, 'NOT_FOUND', 'Client not found');
    const settings = await loadBilling(orgId);

    // Choose the time to bill: explicit entries, or everything unbilled on the named matters.
    let entries: Awaited<ReturnType<typeof timeEntries.findByIds>> = [];
    if (input.timeEntryIds?.length) {
      const ids = [...new Set(input.timeEntryIds)];
      entries = await timeEntries.findByIds(orgId, ids);
      if (entries.length !== ids.length)
        throw new ApiError(404, 'NOT_FOUND', 'Time entry not found');
    } else if (input.matterIds?.length) {
      const ids = [...new Set(input.matterIds)];
      for (const id of ids) {
        const m = await matters.findById(orgId, id);
        if (!m) throw new ApiError(404, 'NOT_FOUND', 'Matter not found');
      }
      entries = await timeEntries.unbilledBillableForMatters(orgId, ids);
    }
    const matterIds = [...new Set(entries.map((e) => String(e.matterId)))];
    await this.assertMattersVisible(
      auth,
      [...matterIds, ...(input.matterIds ?? [])],
      req,
      'Matter not found',
    );
    if (entries.some((e) => String(e.clientId) !== input.clientId)) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'All time entries must belong to the invoiced client',
      );
    }
    if (entries.some((e) => e.status !== 'unbilled' || !e.billable)) {
      throw new ApiError(409, 'CONFLICT', 'Only unbilled, billable time can be invoiced');
    }
    if (entries.some((e) => e.currency !== settings.currency)) {
      throw new ApiError(409, 'CONFLICT', 'Some time entries are in a different currency');
    }

    const lines = entries.map((e) => ({
      type: 'time' as const,
      description: e.description,
      matterId: e.matterId,
      timeEntryId: e._id,
      minutes: e.minutes,
      rateCents: e.rateCents,
      amountCents: e.amountCents,
    }));
    const taxRateBp = input.taxRateBp ?? settings.defaultTaxRateBp;

    const inv = await this.inTx(async (session) => {
      const created = await invoices.create(
        {
          organizationId: orgId as never,
          clientId: input.clientId as never,
          currency: settings.currency,
          status: 'draft',
          lines: lines as never,
          matterIds: matterIds as never,
          taxRateBp,
          dueDays: input.dueDays ?? settings.invoiceDueDays,
          notes: input.notes,
          ...computeTotals(lines, taxRateBp),
          createdBy: auth.userId as never,
        },
        { session },
      );
      // All-or-nothing: if another request billed any of these entries first, the whole draft is abandoned.
      if (
        entries.length > 0 &&
        !(await timeEntries.claim(
          orgId,
          entries.map((e) => e._id),
          created._id,
          { session },
        ))
      ) {
        throw new ApiError(
          409,
          'CONFLICT',
          'Some time entries were just billed on another invoice. Refresh and try again.',
        );
      }
      return created;
    });
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'invoice.created',
      targetType: 'invoice',
      targetId: String(inv._id),
      req,
      meta: { clientId: input.clientId, lines: lines.length, totalCents: inv.totalCents },
    });
    return invoiceDto(inv);
  }

  async list(auth: AuthContext, q: z.infer<typeof invoiceListQuerySchema>) {
    const hiddenMatterIds = await this.access.hiddenMatterIds(auth);
    const page = await invoices.listPage(auth.organizationId, { ...q, hiddenMatterIds });
    return { data: page.data.map(summaryDto), page: page.page };
  }

  async get(auth: AuthContext, id: string, req: Req) {
    return invoiceDto(await this.load(auth, id, req));
  }

  /** A ready-to-send payment reminder for the invoice, written for a person to review and send. */
  async reminderDraft(auth: AuthContext, id: string, req: Req) {
    const inv = await this.load(auth, id, req);
    if (inv.status !== 'issued' || inv.balanceCents <= 0 || !inv.dueAt)
      throw new ApiError(
        409,
        'CONFLICT',
        'Only issued invoices that still owe money need a reminder',
      );
    const [client, org, sender, steps] = await Promise.all([
      clients.findById(auth.organizationId, String(inv.clientId)),
      organizations.findById(auth.organizationId),
      users.findById(auth.userId),
      loadBilling(auth.organizationId),
    ]);
    const past = daysPastDue(inv.dueAt);
    return {
      daysPastDue: past,
      step: reminderStep(past, steps.reminderDays),
      text: reminderMessage({
        clientName: client?.name ?? 'Client',
        invoiceNumber: inv.number ?? 'the invoice',
        balanceCents: inv.balanceCents,
        totalCents: inv.totalCents,
        currency: inv.currency,
        dueAt: inv.dueAt,
        daysPast: past,
        firmName: org?.name ?? '',
        senderName: sender?.name ?? '',
      }),
    };
  }

  /** Records that someone contacted the client about this invoice. */
  async logReminder(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof logInvoiceReminderSchema>,
    req: Req,
  ) {
    await this.load(auth, id, req); // 404 for a hidden invoice
    const inv = await invoices.addReminder(auth.organizationId, id, {
      at: new Date(),
      channel: input.channel,
      note: input.note ?? null,
      by: auth.userId,
    });
    if (!inv)
      throw new ApiError(
        409,
        'CONFLICT',
        'Only issued invoices that still owe money can be followed up',
      );
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'invoice.reminder_logged',
      targetType: 'invoice',
      targetId: id,
      req,
      meta: { channel: input.channel },
    });
    return invoiceDto(inv);
  }

  /** Looks for invoices that have reached a reminder step and notifies the people who should chase them. */
  async runReminders(auth: AuthContext, req: Req) {
    const result = await dispatchInvoiceReminders(auth.organizationId);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'invoice.reminders_run',
      req,
      meta: { invoices: result.invoices, notified: result.notified },
    });
    return result;
  }

  private async editableDraft(auth: AuthContext, id: string, req: Req) {
    const inv = await this.load(auth, id, req);
    if (inv.status !== 'draft')
      throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be changed');
    return inv;
  }

  async update(
    auth: AuthContext,
    id: string,
    patch: z.infer<typeof updateInvoiceSchema>,
    req: Req,
  ) {
    const inv = await this.editableDraft(auth, id, req);
    const taxRateBp = patch.taxRateBp ?? inv.taxRateBp;
    const set: Record<string, unknown> = { ...computeTotals(inv.lines, taxRateBp), taxRateBp };
    if (patch.dueDays !== undefined) set.dueDays = patch.dueDays;
    if (patch.notes !== undefined) set.notes = patch.notes ?? undefined;
    if (patch.taxRateBp !== undefined && patch.taxRateBp !== inv.taxRateBp) {
      set.accountantReviewedAt = null;
      set.accountantReviewedBy = null;
    }
    const updated = await invoices.update(auth.organizationId, id, ['draft'], set);
    if (!updated) throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be changed');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'invoice.updated',
      targetType: 'invoice',
      targetId: id,
      req,
      meta: { fields: Object.keys(patch) },
    });
    return invoiceDto(updated);
  }

  async addLine(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof addInvoiceLineSchema>,
    req: Req,
  ) {
    const orgId = auth.organizationId;
    await this.editableDraft(auth, id, req);
    if (input.matterId) {
      const m = await this.access.load(auth, input.matterId, req);
      const inv0 = await invoices.findById(orgId, id);
      if (String(m.clientId) !== String(inv0!.clientId))
        throw new ApiError(400, 'VALIDATION_FAILED', 'The matter belongs to a different client');
    }
    const updated = await this.inTx(async (session) => {
      const cur = await invoices.findById(orgId, id, { session });
      if (!cur || cur.status !== 'draft')
        throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be changed');
      const lines = [
        ...cur.lines,
        {
          _id: new mongoose.Types.ObjectId(),
          type: input.type,
          description: input.description,
          matterId: (input.matterId ?? null) as never,
          timeEntryId: null,
          minutes: null,
          rateCents: null,
          amountCents: input.amountCents,
        },
      ];
      return invoices.update(
        orgId,
        id,
        ['draft'],
        { lines, matterIds: matterIdsOf(lines as never), ...computeTotals(lines, cur.taxRateBp) },
        { session },
      );
    });
    if (!updated) throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be changed');
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'invoice.line_added',
      targetType: 'invoice',
      targetId: id,
      req,
      meta: { type: input.type, amountCents: input.amountCents },
    });
    return invoiceDto(updated);
  }

  async removeLine(auth: AuthContext, id: string, lineId: string, req: Req) {
    const orgId = auth.organizationId;
    await this.editableDraft(auth, id, req);
    const updated = await this.inTx(async (session) => {
      const cur = await invoices.findById(orgId, id, { session });
      if (!cur || cur.status !== 'draft')
        throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be changed');
      const line = cur.lines.find((l) => String(l._id) === lineId);
      if (!line) throw new ApiError(404, 'NOT_FOUND', 'Line not found');
      if (line.timeEntryId) await timeEntries.release(orgId, [line.timeEntryId], id, { session }); // the time becomes billable again
      const lines = cur.lines.filter((l) => String(l._id) !== lineId);
      return invoices.update(
        orgId,
        id,
        ['draft'],
        { lines, matterIds: matterIdsOf(lines), ...computeTotals(lines, cur.taxRateBp) },
        { session },
      );
    });
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'invoice.line_removed',
      targetType: 'invoice',
      targetId: id,
      req,
    });
    return invoiceDto(updated!);
  }

  async deleteDraft(auth: AuthContext, id: string, req: Req) {
    const orgId = auth.organizationId;
    await this.editableDraft(auth, id, req);
    await this.inTx(async (session) => {
      const cur = await invoices.findById(orgId, id, { session });
      if (!cur || cur.status !== 'draft')
        throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be deleted');
      const entryIds = cur.lines
        .map((l) => l.timeEntryId)
        .filter((x): x is NonNullable<typeof x> => !!x);
      if (entryIds.length) await timeEntries.release(orgId, entryIds, id, { session });
      await invoices.deleteDraft(orgId, id, { session });
    });
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'invoice.draft_deleted',
      targetType: 'invoice',
      targetId: id,
      req,
    });
  }

  async recordAccountantReview(auth: AuthContext, id: string, req: Req) {
    const inv = await this.editableDraft(auth, id, req);
    if (inv.taxRateBp <= 0)
      throw new ApiError(
        409,
        'CONFLICT',
        'There is no tax on this draft. A review is required only when a tax rate has been typed.',
      );
    const updated = await invoices.update(auth.organizationId, id, ['draft'], {
      accountantReviewedAt: new Date(),
      accountantReviewedBy: auth.userId,
    });
    if (!updated) throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be changed');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'invoice.accountant_reviewed',
      targetType: 'invoice',
      targetId: id,
      req,
      meta: { taxRateBp: updated.taxRateBp },
    });
    return invoiceDto(updated);
  }

  async issue(auth: AuthContext, id: string, req: Req) {
    const orgId = auth.organizationId;
    await this.load(auth, id, req);
    const issued = await this.inTx(async (session) => {
      const cur = await invoices.findById(orgId, id, { session });
      if (!cur || cur.status !== 'draft')
        throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be issued');
      if (cur.lines.length === 0)
        throw new ApiError(400, 'VALIDATION_FAILED', 'Add at least one line before issuing');
      if (cur.totalCents <= 0)
        throw new ApiError(400, 'VALIDATION_FAILED', 'The invoice total must be greater than zero');
      if (cur.taxRateBp > 0 && !cur.accountantReviewedAt)
        throw new ApiError(
          409,
          'CONFLICT',
          'An accountant must review this taxed invoice before it is issued. This software does not choose a GST rate.',
        );
      const number = await invoices.nextNumber(orgId, { session });
      const issuedAt = new Date();
      return invoices.update(
        orgId,
        id,
        ['draft'],
        {
          status: 'issued',
          number,
          issuedAt,
          dueAt: new Date(issuedAt.getTime() + cur.dueDays * 86_400_000),
          balanceCents: cur.totalCents,
          amountPaidCents: 0,
        },
        { session },
      );
    });
    if (!issued) throw new ApiError(409, 'CONFLICT', 'Only draft invoices can be issued');
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'invoice.issued',
      targetType: 'invoice',
      targetId: id,
      req,
      meta: { number: issued.number, totalCents: issued.totalCents },
    });
    return invoiceDto(issued);
  }

  async recordPayment(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof recordPaymentSchema>,
    req: Req,
  ) {
    const orgId = auth.organizationId;
    await this.load(auth, id, req);
    if (input.paidAt && isFutureDate(input.paidAt))
      throw new ApiError(400, 'VALIDATION_FAILED', 'Payment date cannot be in the future');
    const updated = await invoices.recordPayment(orgId, id, {
      amountCents: input.amountCents,
      paidAt: input.paidAt ?? new Date(),
      method: input.method,
      reference: input.reference,
      recordedBy: auth.userId as never,
    });
    if (!updated) {
      // Say precisely why, using the current state.
      const cur = await invoices.findById(orgId, id);
      if (cur?.status !== 'issued')
        throw new ApiError(409, 'CONFLICT', 'Payments can only be recorded on issued invoices');
      throw new ApiError(409, 'CONFLICT', 'The payment exceeds the outstanding balance');
    }
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'invoice.payment_recorded',
      targetType: 'invoice',
      targetId: id,
      req,
      meta: { amountCents: input.amountCents, method: input.method, status: updated.status },
    });
    return invoiceDto(updated);
  }

  async void(auth: AuthContext, id: string, reason: string, req: Req) {
    const orgId = auth.organizationId;
    const cur0 = await this.load(auth, id, req);
    if (cur0.status === 'draft')
      throw new ApiError(409, 'CONFLICT', 'Delete a draft instead of voiding it');
    const voided = await this.inTx(async (session) => {
      const cur = await invoices.findById(orgId, id, { session });
      if (!cur || cur.status !== 'issued')
        throw new ApiError(409, 'CONFLICT', 'Only issued invoices can be voided');
      if (cur.amountPaidCents > 0)
        throw new ApiError(409, 'CONFLICT', 'An invoice with payments cannot be voided');
      const entryIds = cur.lines
        .map((l) => l.timeEntryId)
        .filter((x): x is NonNullable<typeof x> => !!x);
      if (entryIds.length) await timeEntries.release(orgId, entryIds, id, { session }); // the time can be billed again
      return invoices.update(
        orgId,
        id,
        ['issued'],
        { status: 'void', voidedAt: new Date(), voidReason: reason, balanceCents: 0 },
        { session },
      );
    });
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'invoice.voided',
      targetType: 'invoice',
      targetId: id,
      req,
      meta: { number: voided!.number },
    });
    return invoiceDto(voided!);
  }
}
