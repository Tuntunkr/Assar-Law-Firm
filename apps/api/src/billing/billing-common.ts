import { billingSettings } from '@assar/database';
import { CURRENCIES, DEFAULT_REMINDER_DAYS, taxAmountCents } from '@assar/types';

export interface OrgBilling {
  currency: string;
  defaultHourlyRateCents: number | null;
  defaultTaxRateBp: number;
  invoiceDueDays: number;
  reminderDays: number[];
}

/** Organizations created before billing existed have no settings: fall back to safe defaults. */
export async function loadBilling(organizationId: string): Promise<OrgBilling> {
  const b = await billingSettings.get(organizationId);
  return {
    currency:
      b?.currency && (CURRENCIES as readonly string[]).includes(b.currency) ? b.currency : 'USD',
    defaultHourlyRateCents: b?.defaultHourlyRateCents ?? null,
    defaultTaxRateBp: b?.defaultTaxRateBp ?? 0,
    invoiceDueDays: b?.invoiceDueDays ?? 30,
    reminderDays: b?.reminderDays?.length ? [...b.reminderDays] : [...DEFAULT_REMINDER_DAYS],
  };
}

export function computeTotals(lines: { amountCents: number }[], taxRateBp: number) {
  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const taxCents = taxAmountCents(subtotalCents, taxRateBp);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export const idStr = (v: unknown) => (v == null ? null : String(v));

/** Work dates may not be more than a day ahead of the server's UTC date (covers time zones, blocks typos). */
export function isFutureDate(d: Date, now = new Date()): boolean {
  return (
    d.getTime() > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86_400_000
  );
}
