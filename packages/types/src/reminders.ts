/** Days relative to the due date on which a reminder is due. Negative = before it falls due. */
export const DEFAULT_REMINDER_DAYS: readonly number[] = [-3, 1, 7, 14, 30];
export const MAX_REMINDER_STEPS = 8;

export const REMINDER_CHANNELS = [
  'email',
  'whatsapp',
  'phone',
  'letter',
  'in_person',
  'other',
] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

const DAY_MS = 86_400_000;

/** Whole days since the due date (negative before it). Compared by calendar day in UTC. */
export function daysPastDue(dueAt: Date | string, now: Date = new Date()): number {
  const d = new Date(dueAt);
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

/**
 * The latest reminder step that has been reached: with steps [-3, 1, 7] and an invoice 9 days past due
 * this is 7; with one that is 5 days before it falls due, null (the first step, -3, is not yet reached).
 * Each step is acted on once, so a missed day never causes a flood of catch-up reminders.
 */
export function reminderStep(
  daysPast: number,
  steps: readonly number[] = DEFAULT_REMINDER_DAYS,
): number | null {
  const reached = steps.filter((s) => s <= daysPast);
  return reached.length ? Math.max(...reached) : null;
}

export const formatCents = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

export interface ReminderFacts {
  clientName: string;
  invoiceNumber: string;
  balanceCents: number;
  totalCents: number;
  currency: string;
  dueAt: Date | string;
  daysPast: number;
  firmName: string;
  senderName: string;
}

/** A polite payment reminder, as plain text a person can review and send themselves. Tone follows how late it is. */
export function reminderMessage(f: ReminderFacts): string {
  const due = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(f.dueAt));
  const partial = f.balanceCents < f.totalCents;
  const amount = `${formatCents(f.balanceCents, f.currency)}${partial ? ` (the remaining balance of ${formatCents(f.totalCents, f.currency)})` : ''}`;
  const opening =
    f.daysPast < 0
      ? `This is a friendly reminder that invoice ${f.invoiceNumber} for ${amount} falls due on ${due}.`
      : f.daysPast === 0
        ? `This is a reminder that invoice ${f.invoiceNumber} for ${amount} is due today (${due}).`
        : f.daysPast < 15
          ? `Our records show that invoice ${f.invoiceNumber} for ${amount}, due on ${due}, has not yet been paid. It is now ${f.daysPast} day${f.daysPast === 1 ? '' : 's'} overdue.`
          : `Invoice ${f.invoiceNumber} for ${amount}, due on ${due}, remains unpaid and is now ${f.daysPast} days overdue. We would be grateful for your prompt attention.`;
  return [
    `Dear ${f.clientName},`,
    '',
    opening,
    '',
    f.daysPast < 0
      ? 'No action is needed if payment is already arranged.'
      : 'If you have already paid, please ignore this message and let us have the payment details so we can update our records. If there is a question about the invoice, please reply and we will help.',
    '',
    'Kind regards,',
    f.senderName,
    f.firmName,
  ].join('\n');
}
