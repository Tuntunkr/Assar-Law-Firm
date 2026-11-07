import type { ClientSession, Types } from 'mongoose';
import { mongoose } from '../connection.js';
import { decodeCursor, toPage } from '../pagination.js';
import {
  CounterModel,
  InvoiceModel,
  MembershipModel,
  OrganizationModel,
  TimeEntryModel,
  type InvoiceDoc,
  type InvoiceLine,
  type InvoicePayment,
  type TimeEntryDoc,
} from '../models/index.js';
import { InvalidCursorError } from './index.js';

type Id = Types.ObjectId | string;
type Tx = { session?: ClientSession };
const oid = (v: Id) => new mongoose.Types.ObjectId(String(v));

function cursorFilter(cursor?: string) {
  const c = decodeCursor(cursor);
  if (c === null) throw new InvalidCursorError();
  return c ? { _id: { $lt: c } } : {};
}

const startOfTodayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

// Every function takes organizationId first and applies it to the query.

export const billingSettings = {
  get: async (organizationId: Id) =>
    (await OrganizationModel.findById(organizationId).select('billing').lean())?.billing,
  set: (
    organizationId: Id,
    billing: NonNullable<import('../models/index.js').OrganizationDoc['billing']>,
  ) =>
    OrganizationModel.findOneAndUpdate(
      { _id: organizationId },
      { billing },
      { returnDocument: 'after' },
    )
      .select('billing')
      .lean(),
  rateFor: async (organizationId: Id, userId: Id) =>
    (await MembershipModel.findOne({ organizationId, userId }).select('hourlyRateCents').lean())
      ?.hourlyRateCents ?? null,
  setMemberRate: (organizationId: Id, userId: Id, hourlyRateCents: number | null) =>
    MembershipModel.findOneAndUpdate(
      { organizationId, userId, status: 'active' },
      { hourlyRateCents },
      { returnDocument: 'after' },
    ).lean(),
};

export const timeEntries = {
  create: async (
    data: Omit<TimeEntryDoc, '_id' | 'createdAt' | 'updatedAt' | 'status' | 'invoiceId'>,
  ) => (await TimeEntryModel.create(data)).toObject(),
  findById: (organizationId: Id, id: Id) =>
    TimeEntryModel.findOne({ _id: id, organizationId }).lean(),
  findByIds: (organizationId: Id, ids: Id[]) =>
    TimeEntryModel.find({ organizationId, _id: { $in: ids } }).lean(),
  /** Only an entry that has not been invoiced can change. */
  updateUnbilled: (organizationId: Id, id: Id, patch: Record<string, unknown>) =>
    TimeEntryModel.findOneAndUpdate({ _id: id, organizationId, status: 'unbilled' }, patch, {
      returnDocument: 'after',
      runValidators: true,
    }).lean(),
  deleteUnbilled: (organizationId: Id, id: Id) =>
    TimeEntryModel.deleteOne({ _id: id, organizationId, status: 'unbilled' }),
  async listPage(
    organizationId: Id,
    o: {
      limit: number;
      cursor?: string;
      matterId?: string;
      clientId?: string;
      userId?: string;
      status?: string;
      billable?: boolean;
      from?: Date;
      to?: Date;
      hiddenMatterIds: Id[];
    },
  ) {
    const filter: Record<string, unknown> = {
      organizationId,
      matterId: o.matterId ? o.matterId : { $nin: o.hiddenMatterIds },
      ...(o.clientId ? { clientId: o.clientId } : {}),
      ...(o.userId ? { userId: o.userId } : {}),
      ...(o.status ? { status: o.status } : {}),
      ...(o.billable !== undefined ? { billable: o.billable } : {}),
      ...(o.from || o.to
        ? { workDate: { ...(o.from ? { $gte: o.from } : {}), ...(o.to ? { $lt: o.to } : {}) } }
        : {}),
      ...cursorFilter(o.cursor),
    };
    const rows = await TimeEntryModel.find(filter)
      .sort({ _id: -1 })
      .limit(o.limit + 1)
      .lean();
    return toPage(rows, o.limit);
  },
  unbilledBillableForMatters: (organizationId: Id, matterIds: Id[]) =>
    TimeEntryModel.find({
      organizationId,
      matterId: { $in: matterIds },
      status: 'unbilled',
      billable: true,
    })
      .sort({ workDate: 1, _id: 1 })
      .limit(2000)
      .lean(),
  /**
   * Atomically attaches entries to an invoice. All-or-nothing: returns false (and the caller aborts its
   * transaction) if any entry was already billed, changed to non-billable, or deleted in the meantime.
   */
  async claim(organizationId: Id, ids: Id[], invoiceId: Id, tx: Tx = {}): Promise<boolean> {
    const res = await TimeEntryModel.updateMany(
      { organizationId, _id: { $in: ids }, status: 'unbilled', billable: true },
      { status: 'invoiced', invoiceId },
      tx,
    );
    return res.modifiedCount === ids.length;
  },
  release: (organizationId: Id, ids: Id[], invoiceId: Id, tx: Tx = {}) =>
    TimeEntryModel.updateMany(
      { organizationId, _id: { $in: ids }, invoiceId },
      { status: 'unbilled', invoiceId: null },
      tx,
    ),
};

export const invoices = {
  create: async (
    data: Partial<InvoiceDoc> &
      Pick<InvoiceDoc, 'organizationId' | 'clientId' | 'currency' | 'createdBy'>,
    tx: Tx = {},
  ) => (await InvoiceModel.create([data], tx))[0]!.toObject(),
  findById: (organizationId: Id, id: Id, tx: Tx = {}) =>
    InvoiceModel.findOne({ _id: id, organizationId }, null, tx).lean(),
  async nextNumber(organizationId: Id, tx: Tx = {}): Promise<string> {
    const c = await CounterModel.findOneAndUpdate(
      { _id: `invoice:${organizationId}` },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', ...tx },
    );
    return `INV-${new Date().getUTCFullYear()}-${String(c!.seq).padStart(5, '0')}`;
  },
  /** Compare-and-set on status so two requests can't both transition (or edit) the same invoice. */
  update: (
    organizationId: Id,
    id: Id,
    expectStatus: InvoiceDoc['status'][],
    patch: Record<string, unknown>,
    tx: Tx = {},
  ) =>
    InvoiceModel.findOneAndUpdate(
      { _id: id, organizationId, status: { $in: expectStatus } },
      patch,
      { returnDocument: 'after', ...tx },
    ).lean(),
  /** Logs that someone contacted the client. Plain $push (the note is user text), capped at the last 50. */
  addReminder: (
    organizationId: Id,
    id: Id,
    entry: { at: Date; channel: string; note?: string | null; by: Id },
  ) =>
    InvoiceModel.findOneAndUpdate(
      { _id: id, organizationId, status: 'issued', balanceCents: { $gt: 0 } },
      { $push: { reminders: { $each: [entry], $slice: -50 } } },
      { returnDocument: 'after' },
    ).lean(),
  deleteDraft: (organizationId: Id, id: Id, tx: Tx = {}) =>
    InvoiceModel.deleteOne({ _id: id, organizationId, status: 'draft' }, tx),
  async listPage(
    organizationId: Id,
    o: {
      limit: number;
      cursor?: string;
      clientId?: string;
      status?: string;
      /** Issued, still owing, and past its due date. */
      overdue?: boolean;
      hiddenMatterIds: Id[];
    },
  ) {
    const filter: Record<string, unknown> = {
      organizationId,
      // An invoice touching a matter the viewer can't see is invisible to them.
      matterIds: { $nin: o.hiddenMatterIds },
      ...(o.clientId ? { clientId: o.clientId } : {}),
      ...(o.status ? { status: o.status } : {}),
      ...(o.overdue
        ? { status: 'issued', balanceCents: { $gt: 0 }, dueAt: { $lt: startOfTodayUtc() } }
        : {}),
      ...cursorFilter(o.cursor),
    };
    const rows = await InvoiceModel.find(filter)
      .select('-lines')
      .sort({ _id: -1 })
      .limit(o.limit + 1)
      .lean();
    return toPage(rows, o.limit);
  },
  /**
   * Records a payment atomically. The filter guarantees the invoice is issued and the payment does not
   * exceed the balance at the moment of the write, so concurrent payments can never overpay it.
   */
  recordPayment: (organizationId: Id, id: Id, payment: Omit<InvoicePayment, '_id'>) =>
    InvoiceModel.findOneAndUpdate(
      { _id: id, organizationId, status: 'issued', balanceCents: { $gte: payment.amountCents } },
      [
        {
          $set: {
            // $literal: the payment contains user text (e.g. `reference`). Inside an aggregation pipeline a string
            // beginning with "$" would otherwise be evaluated as an expression (operator injection).
            payments: {
              $concatArrays: [
                '$payments',
                [
                  {
                    $literal: {
                      ...payment,
                      _id: new mongoose.Types.ObjectId(),
                      recordedBy: oid(payment.recordedBy),
                    },
                  },
                ],
              ],
            },
            amountPaidCents: { $add: ['$amountPaidCents', payment.amountCents] },
            balanceCents: { $subtract: ['$balanceCents', payment.amountCents] },
          },
        },
        {
          $set: {
            status: { $cond: [{ $eq: ['$balanceCents', 0] }, 'paid', '$status'] },
            paidAt: { $cond: [{ $eq: ['$balanceCents', 0] }, payment.paidAt, '$paidAt'] },
          },
        },
      ],
      { returnDocument: 'after', updatePipeline: true },
    ).lean(),
};

export type { InvoiceLine };

export const billingReports = {
  async time(
    organizationId: Id,
    o: {
      from: Date;
      to: Date;
      groupBy: 'user' | 'matter' | 'client';
      userId?: string;
      hiddenMatterIds: Id[];
    },
  ) {
    const key =
      o.groupBy === 'user' ? '$userId' : o.groupBy === 'matter' ? '$matterId' : '$clientId';
    return TimeEntryModel.aggregate<{
      _id: Types.ObjectId;
      entries: number;
      minutes: number;
      billableMinutes: number;
      billableAmountCents: number;
      unbilledAmountCents: number;
    }>([
      {
        $match: {
          organizationId: oid(organizationId),
          workDate: { $gte: o.from, $lt: o.to },
          matterId: { $nin: o.hiddenMatterIds.map(oid) },
          ...(o.userId ? { userId: oid(o.userId) } : {}),
        },
      },
      {
        $group: {
          _id: key,
          entries: { $sum: 1 },
          minutes: { $sum: '$minutes' },
          billableMinutes: { $sum: { $cond: ['$billable', '$minutes', 0] } },
          billableAmountCents: { $sum: '$amountCents' },
          unbilledAmountCents: {
            $sum: { $cond: [{ $eq: ['$status', 'unbilled'] }, '$amountCents', 0] },
          },
        },
      },
      { $sort: { billableAmountCents: -1, minutes: -1 } },
      { $limit: 1000 },
    ]);
  },

  async summary(
    organizationId: Id,
    o: { from: Date; to: Date; now: Date; hiddenMatterIds: Id[]; userScope?: string },
  ) {
    const org = oid(organizationId);
    const hidden = o.hiddenMatterIds.map(oid);
    const visible = { organizationId: org, matterIds: { $nin: hidden } };
    const [invoiced, collected, open, wip] = await Promise.all([
      InvoiceModel.aggregate<{ _id: null; cents: number; count: number }>([
        {
          $match: {
            ...visible,
            status: { $in: ['issued', 'paid'] },
            issuedAt: { $gte: o.from, $lt: o.to },
          },
        },
        { $group: { _id: null, cents: { $sum: '$totalCents' }, count: { $sum: 1 } } },
      ]),
      InvoiceModel.aggregate<{ _id: null; cents: number; count: number }>([
        {
          $match: {
            ...visible,
            status: { $in: ['issued', 'paid'] },
            'payments.paidAt': { $gte: o.from, $lt: o.to },
          },
        },
        { $unwind: '$payments' },
        { $match: { 'payments.paidAt': { $gte: o.from, $lt: o.to } } },
        { $group: { _id: null, cents: { $sum: '$payments.amountCents' }, count: { $sum: 1 } } },
      ]),
      InvoiceModel.aggregate<{ _id: string; cents: number; count: number }>([
        { $match: { ...visible, status: 'issued' } },
        {
          $group: {
            _id: { $cond: [{ $lt: ['$dueAt', o.now] }, 'overdue', 'current'] },
            cents: { $sum: '$balanceCents' },
            count: { $sum: 1 },
          },
        },
      ]),
      TimeEntryModel.aggregate<{ _id: null; cents: number; minutes: number }>([
        {
          $match: {
            organizationId: org,
            status: 'unbilled',
            billable: true,
            matterId: { $nin: hidden },
          },
        },
        { $group: { _id: null, cents: { $sum: '$amountCents' }, minutes: { $sum: '$minutes' } } },
      ]),
    ]);
    const by = (k: string) => open.find((r) => r._id === k) ?? { cents: 0, count: 0 };
    return {
      invoicedCents: invoiced[0]?.cents ?? 0,
      invoicesIssued: invoiced[0]?.count ?? 0,
      collectedCents: collected[0]?.cents ?? 0,
      paymentsReceived: collected[0]?.count ?? 0,
      outstandingCents: by('current').cents + by('overdue').cents,
      overdueCents: by('overdue').cents,
      openInvoices: by('current').count + by('overdue').count,
      unbilledCents: wip[0]?.cents ?? 0,
      unbilledMinutes: wip[0]?.minutes ?? 0,
    };
  },

  /** Issued invoices with a balance, with just what aging needs. */
  openInvoices: (organizationId: Id, hiddenMatterIds: Id[]) =>
    InvoiceModel.find({
      organizationId,
      status: 'issued',
      balanceCents: { $gt: 0 },
      matterIds: { $nin: hiddenMatterIds },
    })
      .select('number clientId dueAt balanceCents totalCents')
      .limit(20_000)
      .lean(),

  exportTime: (
    organizationId: Id,
    o: { from: Date; to: Date; userId?: string; hiddenMatterIds: Id[] },
    limit: number,
  ) =>
    TimeEntryModel.find({
      organizationId,
      workDate: { $gte: o.from, $lt: o.to },
      matterId: { $nin: o.hiddenMatterIds },
      ...(o.userId ? { userId: o.userId } : {}),
    })
      .sort({ workDate: 1, _id: 1 })
      .limit(limit)
      .lean(),
};

/** True once any time entry or non-void invoice exists (the currency can no longer change). */
export async function hasBillingData(organizationId: Id): Promise<boolean> {
  const [t, i] = await Promise.all([
    TimeEntryModel.exists({ organizationId }),
    InvoiceModel.exists({ organizationId, status: { $ne: 'void' } }),
  ]);
  return t !== null || i !== null;
}
