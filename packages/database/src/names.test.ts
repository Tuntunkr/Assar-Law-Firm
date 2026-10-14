import { describe, expect, it } from 'vitest';
import { compareTokens, nameTokens, normalizeName } from './names.js';

const cmp = (a: string, b: string) => compareTokens(nameTokens(a), nameTokens(b));

describe('name matching', () => {
  it('normalizes punctuation, case and Latin diacritics but keeps other scripts', () => {
    expect(normalizeName("  José  O'Brien-Smith ")).toBe('jose o brien smith');
    expect(normalizeName('मोहन शर्मा')).toBe('मोहन शर्मा');
  });
  it('matches the same words in any order exactly', () => {
    expect(cmp('John Smith', 'smith, john')).toBe('exact');
  });
  it('ignores corporate suffixes', () => {
    expect(cmp('Acme Holdings LLC', 'ACME Holdings, Inc.')).toBe('exact');
  });
  it('flags containment with at least two shared words as similar', () => {
    expect(cmp('John Smith', 'John A. Smith')).toBe('similar');
  });
  it('does not match single shared words or unrelated names', () => {
    expect(cmp('John Smith', 'John Brown')).toBeNull();
    expect(cmp('Acme Holdings', 'Globex Holdings')).toBeNull();
    expect(cmp('Smith', 'Smith Jones')).toBeNull();
  });
  it('matches single-word names only exactly', () => {
    expect(cmp('Madonna', 'madonna')).toBe('exact');
  });
});
