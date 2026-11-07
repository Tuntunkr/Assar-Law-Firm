const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
const dateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
const time = new Intl.DateTimeFormat('en', { timeStyle: 'short' });

export const formatDate = (iso: string | null | undefined) =>
  iso ? date.format(new Date(iso)) : '—';
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTime.format(new Date(iso)) : '—';
export const formatTime = (iso: string) => time.format(new Date(iso));

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Money is integer cents everywhere; this is the only place it becomes a display string. */
export function formatMoney(cents: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Parses "125.50" into 12550 cents without floating-point drift; null if it is not a valid amount. */
export function parseMoneyToCents(input: string): number | null {
  const m = /^\s*(-?)(\d{1,10})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}

export const formatHours = (minutes: number) => `${(minutes / 60).toFixed(2)} h`;

/** "1.5", "1:30" or "90m" → minutes; null when unparseable. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /^(\d+):([0-5]\d)$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+)\s*m(?:in)?$/.exec(s))) return Number(m[1]);
  if ((m = /^(\d+(?:\.\d+)?)\s*h?$/.exec(s))) return Math.round(Number(m[1]) * 60);
  return null;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const startOfMonth = () => today().slice(0, 8) + '01';

export const label = (s: string) => s.replace(/_/g, ' ');

export const AREA_LABEL: Record<string, string> = {
  litigation: 'Litigation',
  corporate: 'Corporate',
  family: 'Family',
  real_estate: 'Real estate',
  employment: 'Employment',
  intellectual_property: 'Intellectual property',
  criminal: 'Criminal',
  immigration: 'Immigration',
  tax: 'Tax',
  other: 'Other',
};

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray';
const TONES: Record<string, Tone> = {
  open: 'green',
  active: 'green',
  paid: 'green',
  done: 'green',
  approved: 'green',
  succeeded: 'green',
  completed: 'green',
  pending: 'amber',
  issued: 'blue',
  draft: 'amber',
  queued: 'amber',
  processing: 'blue',
  in_progress: 'blue',
  scheduled: 'blue',
  high: 'red',
  failed: 'red',
  rejected: 'red',
  void: 'red',
  disabled: 'red',
  infected: 'red',
};
export const toneOf = (status: string): Tone => TONES[status] ?? 'gray';

/** Apply `dueAt` colouring: overdue tasks stand out. */
export const isOverdue = (iso: string | null, status: string) =>
  !!iso && status !== 'done' && status !== 'cancelled' && new Date(iso).getTime() < Date.now();
