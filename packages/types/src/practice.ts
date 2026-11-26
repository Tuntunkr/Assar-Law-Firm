/** Calendar day in Asia/Kolkata, `YYYY-MM-DD`. Not a court rule and not a limitation period. */
export const PRACTICE_TIMEZONE = 'Asia/Kolkata';

export const HEARING_RESULTS = [
  'adjourned',
  'heard',
  'order_passed',
  'reserved',
  'dismissed',
  'allowed',
  'settled',
  'not_reached',
  'other',
] as const;
export type HearingResult = (typeof HEARING_RESULTS)[number];

export const DEADLINE_KINDS = ['limitation', 'other_deadline'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export const DEADLINE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'closed',
] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

export const MESSAGE_CHANNELS = ['email', 'whatsapp'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** A CNR is 16 letters or digits. Checking the shape does not contact a court. */
export function cnrProblem(value: string): string | null {
  const v = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{16}$/.test(v))
    return 'CNR must be 16 letters or digits. This checks the shape only.';
  return null;
}

export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PRACTICE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Whole calendar days from `today` to `due` in Asia/Kolkata. Negative means overdue. */
export function istDaysUntil(dueOn: string, now: Date = new Date()): number {
  const today = istDate(now);
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${dueOn}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function isStaleVerification(
  verifiedAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!verifiedAt) return false;
  return now.getTime() - new Date(verifiedAt).getTime() > 7 * 86_400_000;
}

/**
 * Hosts that must never be treated as a live n8n target. `example.com` is documentation only.
 * Local hosts are allowed so tests can bind a throw-away server.
 */
export function webhookHostProblem(url: string | undefined): string | null {
  if (!url) return 'unset';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'invalid';
  }
  if (
    host === 'example.com' ||
    host.endsWith('.example.com') ||
    host === 'example.org' ||
    host.endsWith('.example.org')
  )
    return 'example-host';
  return null;
}

/** What approval is allowed to do. Mock never opens a socket. Anything else is a gate, not a send. */
export function decideDelivery(provider: 'mock' | 'unconfigured'): {
  status: 'mock_delivered' | 'external_activation_gate';
  provider: 'mock' | 'unconfigured';
} {
  if (provider === 'mock') return { status: 'mock_delivered', provider: 'mock' };
  return { status: 'external_activation_gate', provider: 'unconfigured' };
}
