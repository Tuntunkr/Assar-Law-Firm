/**
 * Document templates use `{{key}}` placeholders. Substitution is a single pass of plain text: a value
 * that itself contains `{{x}}` is NOT expanded again, and nothing in a template is ever executed.
 */
export const TEMPLATE_CATEGORIES = [
  'notice',
  'contract',
  'agreement',
  'petition',
  'letter',
  'engagement',
  'other',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const MAX_TEMPLATE_CHARS = 50_000;
export const MAX_PLACEHOLDER_VALUE_CHARS = 2_000;

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_.]{0,60})\s*\}\}/g;

/** Facts the system fills in from the matter, client, court and firm. Anything else is typed by the user. */
export const BUILTIN_PLACEHOLDERS = [
  { key: 'today', label: "Today's date", source: 'system' },
  { key: 'firm.name', label: 'Firm name', source: 'firm' },
  { key: 'author.name', label: 'Your name', source: 'user' },
  { key: 'client.name', label: 'Client name', source: 'client' },
  { key: 'client.type', label: 'Client type', source: 'client' },
  { key: 'client.email', label: 'Client email', source: 'client' },
  { key: 'client.phone', label: 'Client phone', source: 'client' },
  { key: 'client.address', label: 'Client address', source: 'client' },
  { key: 'matter.title', label: 'Matter title', source: 'matter' },
  { key: 'matter.number', label: 'Matter number', source: 'matter' },
  { key: 'matter.practice_area', label: 'Practice area', source: 'matter' },
  { key: 'matter.description', label: 'Matter description', source: 'matter' },
  { key: 'matter.opened_on', label: 'Matter opened on', source: 'matter' },
  { key: 'attorney.name', label: 'Lead attorney', source: 'matter' },
  { key: 'court.name', label: 'Court', source: 'matter' },
  { key: 'court.case_number', label: 'Case number', source: 'matter' },
  { key: 'court.judge', label: 'Judge', source: 'matter' },
  { key: 'court.courtroom', label: 'Courtroom', source: 'matter' },
  { key: 'court.jurisdiction', label: 'Jurisdiction', source: 'matter' },
  { key: 'court.filed_on', label: 'Filed on', source: 'matter' },
  { key: 'party.opposing.name', label: 'Opposing party', source: 'matter' },
  { key: 'party.opposing_counsel.name', label: 'Opposing counsel', source: 'matter' },
] as const;
export const BUILTIN_KEYS: ReadonlySet<string> = new Set(BUILTIN_PLACEHOLDERS.map((p) => p.key));

/** Distinct placeholder keys in the order they first appear. */
export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) seen.add(m[1]!);
  return [...seen];
}

export interface RenderResult {
  text: string;
  /** Keys that had no value, left in the text as `[MISSING: key]` so they cannot be overlooked. */
  missing: string[];
}

/** Replaces each placeholder using `resolve`; a null/empty answer leaves a visible `[MISSING: key]`. */
export function renderTemplate(
  body: string,
  resolve: (key: string) => string | null | undefined,
): RenderResult {
  const missing = new Set<string>();
  const text = body.replace(PLACEHOLDER, (_all, key: string) => {
    const v = resolve(key);
    if (v == null || v.trim() === '') {
      missing.add(key);
      return `[MISSING: ${key}]`;
    }
    return v;
  });
  return { text, missing: [...missing] };
}
