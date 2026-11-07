import {
  DEFAULT_REMINDER_DAYS,
  daysPastDue,
  formatCents,
  hasPermission,
  reminderStep,
} from '@assar/types';
import { ClientModel, InvoiceModel, MembershipModel, OrganizationModel } from '../models/index.js';
import { notifications } from './portal.js';
import { userCanAccessMatter } from './ai.js';

type Id = string | { toString(): string };

export interface ReminderRunResult {
  /** Invoices that reached a reminder step on this run. */
  invoices: number;
  /** In-app notifications created (repeat runs create none: each is keyed by invoice, step and person). */
  notified: number;
}

/**
 * Tells the right people that an invoice has reached a reminder step. "The right people" are the invoice's
 * creator and everyone who can edit billing — and only those who can see every matter on the invoice.
 * Idempotent: a notification is keyed by invoice, step and person, so running this every hour (or twice by
 * mistake) never repeats one, and a missed day never causes a flood of catch-up messages.
 */
export async function dispatchInvoiceReminders(
  organizationId: Id,
  now: Date = new Date(),
): Promise<ReminderRunResult> {
  const org = organizationId as never;
  const settings = await OrganizationModel.findById(org).select('billing').lean();
  const steps = settings?.billing?.reminderDays?.length
    ? settings.billing.reminderDays
    : [...DEFAULT_REMINDER_DAYS];

  const open = await InvoiceModel.find({
    organizationId: org,
    status: 'issued',
    balanceCents: { $gt: 0 },
    dueAt: { $ne: null },
  })
    .select('number clientId matterIds balanceCents currency dueAt createdBy')
    .limit(20_000)
    .lean();
  if (open.length === 0) return { invoices: 0, notified: 0 };

  const members = await MembershipModel.find({ organizationId: org, status: 'active' })
    .select('userId role')
    .lean();
  const billers = members
    .filter((m) => hasPermission(m.role, 'billing:write'))
    .map((m) => String(m.userId));
  const active = new Set(members.map((m) => String(m.userId)));
  const clientIds = [...new Set(open.map((i) => String(i.clientId)))];
  const clientNames = new Map(
    (
      await ClientModel.find({ organizationId: org, _id: { $in: clientIds as never[] } })
        .select('name')
        .lean()
    ).map((c) => [String(c._id), c.name]),
  );

  let invoices = 0;
  let notified = 0;
  for (const inv of open) {
    const past = daysPastDue(inv.dueAt!, now);
    const step = reminderStep(past, steps);
    if (step === null) continue;
    invoices++;
    const recipients = new Set(billers);
    if (active.has(String(inv.createdBy))) recipients.add(String(inv.createdBy));
    const owes = `${clientNames.get(String(inv.clientId)) ?? 'The client'} owes ${formatCents(inv.balanceCents, inv.currency)}`;
    const title =
      past < 0
        ? `Invoice ${inv.number} falls due in ${-past} day${past === -1 ? '' : 's'}`
        : past === 0
          ? `Invoice ${inv.number} is due today`
          : `Invoice ${inv.number} is ${past} day${past === 1 ? '' : 's'} overdue`;
    for (const userId of recipients) {
      // Someone who cannot see one of the invoice's matters must not learn about it from a notification.
      let allowed = true;
      for (const matterId of inv.matterIds ?? []) {
        if (!(await userCanAccessMatter(organizationId as never, matterId, userId as never))) {
          allowed = false;
          break;
        }
      }
      if (!allowed) continue;
      const r = await notifications.create({
        organizationId: org,
        userId: userId as never,
        title,
        body: `${owes} (due ${new Date(inv.dueAt!).toISOString().slice(0, 10)}).`,
        link: { type: 'invoice', id: String(inv._id) },
        dedupeKey: `invoice-reminder:${inv._id}:${step}:${userId}`,
        source: 'system',
      });
      if (r.created) notified++;
    }
  }
  return { invoices, notified };
}
