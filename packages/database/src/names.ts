/** Corporate suffixes ignored when comparing names ("Acme LLC" ≈ "Acme"). */
const SUFFIXES = new Set([
  'llc',
  'llp',
  'lp',
  'inc',
  'incorporated',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'pllc',
  'pc',
  'pvt',
  'gmbh',
  'sa',
  'ag',
]);

/**
 * Lowercases, strips punctuation and Latin diacritics, collapses whitespace.
 * Diacritics are only removed from Latin letters so non-Latin scripts are preserved.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distinct comparison tokens; suffixes are dropped unless they would leave nothing. */
export function nameTokens(name: string): string[] {
  const all = normalizeName(name).split(' ').filter(Boolean);
  const meaningful = all.filter((t) => !SUFFIXES.has(t));
  return [...new Set(meaningful.length > 0 ? meaningful : all)];
}

export type NameMatch = 'exact' | 'similar' | null;

/**
 * exact   – same words in any order (after normalization).
 * similar – at least two shared words and one name's words are contained in the other's,
 *           or the overlap is >= 2/3 of all distinct words.
 * Single-word names only ever match exactly, to avoid noisy results.
 */
export function compareTokens(a: string[], b: string[]): NameMatch {
  if (a.length === 0 || b.length === 0) return null;
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  if (shared === a.length && shared === b.length) return 'exact';
  if (shared < 2) return null;
  const contained = shared === Math.min(a.length, b.length);
  const union = new Set([...a, ...b]).size;
  return contained || shared / union >= 2 / 3 ? 'similar' : null;
}
