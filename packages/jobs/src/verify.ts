import { z } from 'zod';
import type { AiTask } from '@assar/types';
import { TASKS_REQUIRING_CITATIONS, type Source } from './prompts.js';

const citationSchema = z.object({ sourceId: z.string(), quote: z.string() });
const itemSchema = z.object({
  label: z.string().default('Item'),
  text: z.string().default(''),
  dateText: z.string().nullable().optional(),
  risk: z.enum(['low', 'medium', 'high', 'unclear']).nullable().optional(),
  citations: z.array(citationSchema).default([]),
});
export const modelOutputSchema = z.object({
  title: z.string().default(''),
  body: z.string().default(''),
  answerable: z.boolean().default(true),
  items: z.array(itemSchema).default([]),
  assumptions: z.array(z.string()).default([]),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

export interface VerifiedItem {
  label: string;
  text: string;
  dateText: string | null;
  risk: string | null;
  citations: { sourceId: string; quote: string; verified: boolean }[];
  verified: boolean;
  issues: string[];
}
export interface VerifiedResult {
  title: string;
  body: string;
  answerable: boolean;
  items: VerifiedItem[];
  assumptions: string[];
  verification: {
    status: 'all_verified' | 'partially_verified' | 'unverified' | 'nothing_to_verify';
    itemsTotal: number;
    itemsVerified: number;
    itemsUnverified: number;
    /** Legal-authority-looking text in the output that doesn't appear in any source. Treat as unsupported. */
    unsupportedAuthorities: string[];
    notes: string[];
  };
}

/** Whitespace/case/quote-style insensitive form used only for comparing quotes with source text. */
export const canon = (s: string) =>
  s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Parses the model's JSON. Throws a ZodError / SyntaxError if it isn't the agreed shape. */
export function parseModelOutput(raw: string): ModelOutput {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return modelOutputSchema.parse(JSON.parse(trimmed));
}

const AUTHORITY_PATTERNS: RegExp[] = [
  /\b\d{1,4}\s+(?:U\.S\.C\.?|C\.F\.R\.?|U\.S\.|S\.\s?Ct\.|F\.\s?(?:2d|3d|4th)|F\.\s?Supp\.(?:\s?[23]d)?)\s*(?:§+\s*)?\d+[\w.-]*/g,
  /§+\s?\d+[\w.()-]*/g,
  /\b[A-Z][A-Za-z.&'-]+(?:\s+[A-Z][A-Za-z.&'-]+){0,3}\s+v\.\s+[A-Z][A-Za-z.&'-]+(?:\s+[A-Z][A-Za-z.&'-]+){0,3}/g,
];

/** Heuristic: authority-like strings in model text that no source contains. */
export function findUnsupportedAuthorities(texts: string[], sources: Source[]): string[] {
  const corpus = canon(sources.map((s) => s.text).join('\n'));
  const found = new Set<string>();
  for (const t of texts) {
    for (const re of AUTHORITY_PATTERNS) {
      for (const m of t.matchAll(re)) {
        const hit = m[0].trim();
        if (!corpus.includes(canon(hit))) found.add(hit);
      }
    }
  }
  return [...found];
}

const MIN_QUOTE_CHARS = 6;

/**
 * Checks the model's claims against the real source text. Nothing is silently trusted:
 *  - a citation is verified only if its sourceId exists and its quote appears in that source;
 *  - an item is verified only if all its citations are (and, for evidence-based tasks, it has one);
 *  - a `dateText` must literally appear in one of the item's verified quotes;
 *  - authority-like strings absent from every source are reported.
 * Unverified items are kept but flagged, so a lawyer sees what could not be checked.
 */
export function verifyOutput(task: AiTask, output: ModelOutput, sources: Source[]): VerifiedResult {
  const byId = new Map(sources.map((s) => [s.id, { ...s, canon: canon(s.text) }]));
  const needsCitations = TASKS_REQUIRING_CITATIONS.includes(task);
  const notes: string[] = [];

  const items: VerifiedItem[] = output.items.map((item) => {
    const issues: string[] = [];
    const citations = item.citations.map((c) => {
      const src = byId.get(c.sourceId);
      const q = canon(c.quote);
      let ok = true;
      if (!src) {
        ok = false;
        issues.push(`Unknown source "${c.sourceId}"`);
      } else if (q.length < MIN_QUOTE_CHARS) {
        ok = false;
        issues.push('Quote too short to verify');
      } else if (!src.canon.includes(q)) {
        ok = false;
        issues.push('Quote not found in the cited source');
      }
      return { sourceId: c.sourceId, quote: c.quote, verified: ok };
    });
    if (needsCitations && citations.length === 0) issues.push('No supporting citation');

    const dateText = item.dateText?.trim() || null;
    if (dateText) {
      const d = canon(dateText);
      const inQuote = citations.some((c) => c.verified && canon(c.quote).includes(d));
      if (!inQuote) issues.push('Date does not appear in a verified quote');
    }
    return {
      label: item.label,
      text: item.text,
      dateText,
      risk: item.risk ?? null,
      citations,
      verified: issues.length === 0,
      issues,
    };
  });

  const unsupportedAuthorities = findUnsupportedAuthorities(
    [output.body, output.title, ...output.items.map((i) => i.text), ...output.assumptions],
    sources,
  );
  if (unsupportedAuthorities.length)
    notes.push(
      'The output mentions legal authorities that are not in the provided sources. Do not rely on them.',
    );
  if (needsCitations && output.answerable && items.length === 0)
    notes.push('The model returned no citable items.');
  if (sources.some((s) => s.truncated))
    notes.push('Some sources were truncated; the analysis covers only the text provided.');

  const itemsVerified = items.filter((i) => i.verified).length;
  const status: VerifiedResult['verification']['status'] =
    items.length === 0
      ? 'nothing_to_verify'
      : itemsVerified === items.length
        ? 'all_verified'
        : itemsVerified === 0
          ? 'unverified'
          : 'partially_verified';

  return {
    title: output.title,
    body: output.body,
    answerable: output.answerable,
    items,
    assumptions: output.assumptions,
    verification: {
      status,
      itemsTotal: items.length,
      itemsVerified,
      itemsUnverified: items.length - itemsVerified,
      unsupportedAuthorities,
      notes,
    },
  };
}
