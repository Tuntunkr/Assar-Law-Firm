import { describe, expect, it } from 'vitest';
import type { Source } from './prompts.js';
import {
  findUnsupportedAuthorities,
  parseModelOutput,
  verifyOutput,
  type ModelOutput,
} from './verify.js';

const src = (id: string, text: string, truncated = false): Source => ({
  id,
  documentId: 'd' + id,
  version: 1,
  title: 'Doc ' + id,
  filename: id + '.txt',
  text,
  truncated,
});
const SOURCES = [
  src(
    'S1',
    'This Agreement is made on 12 March 2024 between Acme Holdings LLC and Beta Supplies Ltd.\nThe term is twelve (12) months.',
  ),
  src('S2', 'Either party may terminate on 30 days’ written notice.'),
];
const out = (o: Partial<ModelOutput>): ModelOutput => ({
  title: 'T',
  body: '',
  answerable: true,
  items: [],
  assumptions: [],
  ...o,
});
const item = (o: object) =>
  ({
    label: 'Fact',
    text: 'x',
    dateText: null,
    risk: null,
    citations: [],
    ...o,
  }) as ModelOutput['items'][number];

describe('verifyOutput', () => {
  it('accepts quotes that appear in the cited source, ignoring case, spacing and quote style', () => {
    const r = verifyOutput(
      'summary',
      out({
        items: [
          item({
            citations: [
              { sourceId: 'S1', quote: 'the TERM  is twelve (12)\nmonths' },
              { sourceId: 'S2', quote: "30 days' written notice" },
            ],
          }),
        ],
      }),
      SOURCES,
    );
    expect(r.items[0]).toMatchObject({ verified: true, issues: [] });
    expect(r.verification).toMatchObject({
      status: 'all_verified',
      itemsVerified: 1,
      itemsUnverified: 0,
    });
  });

  it('flags a fabricated quote instead of trusting it', () => {
    const r = verifyOutput(
      'summary',
      out({
        items: [
          item({
            citations: [{ sourceId: 'S1', quote: 'The penalty for late delivery is 5% per day' }],
          }),
        ],
      }),
      SOURCES,
    );
    expect(r.items[0]!.verified).toBe(false);
    expect(r.items[0]!.citations[0]!.verified).toBe(false);
    expect(r.items[0]!.issues).toContain('Quote not found in the cited source');
    expect(r.verification.status).toBe('unverified');
  });

  it('flags unknown sources, quotes cited against the wrong source, and trivially short quotes', () => {
    const r = verifyOutput(
      'summary',
      out({
        items: [
          item({ citations: [{ sourceId: 'S9', quote: 'whatever the model wrote here' }] }),
          item({ citations: [{ sourceId: 'S2', quote: 'twelve (12) months' }] }), // exists, but in S1
          item({ citations: [{ sourceId: 'S1', quote: 'term' }] }),
        ],
      }),
      SOURCES,
    );
    expect(r.items.map((i) => i.verified)).toEqual([false, false, false]);
    expect(r.items[0]!.issues[0]).toMatch(/Unknown source/);
    expect(r.items[2]!.issues).toContain('Quote too short to verify');
  });

  it('requires citations for evidence-based tasks but not for missing-info checklists', () => {
    const uncited = out({ items: [item({ text: 'Something' })] });
    expect(verifyOutput('summary', uncited, SOURCES).items[0]!.issues).toContain(
      'No supporting citation',
    );
    expect(verifyOutput('chronology', uncited, SOURCES).items[0]!.verified).toBe(false);
    expect(verifyOutput('missing_info', uncited, SOURCES).items[0]!.verified).toBe(true);
    expect(verifyOutput('drafting', uncited, SOURCES).items[0]!.verified).toBe(true);
  });

  it('only accepts a date that literally appears in a verified quote (never computed or inferred)', () => {
    const ok = verifyOutput(
      'chronology',
      out({
        items: [
          item({
            dateText: '12 March 2024',
            citations: [{ sourceId: 'S1', quote: 'made on 12 March 2024 between Acme' }],
          }),
        ],
      }),
      SOURCES,
    );
    expect(ok.items[0]!.verified).toBe(true);
    const inferred = verifyOutput(
      'chronology',
      out({
        items: [
          item({
            dateText: '12 March 2025',
            citations: [{ sourceId: 'S1', quote: 'The term is twelve (12) months' }],
          }),
        ],
      }),
      SOURCES,
    );
    expect(inferred.items[0]!.verified).toBe(false);
    expect(inferred.items[0]!.issues).toContain('Date does not appear in a verified quote');
  });

  it('reports a mix as partially verified and notes truncation', () => {
    const r = verifyOutput(
      'summary',
      out({
        items: [
          item({ citations: [{ sourceId: 'S2', quote: 'terminate on 30 days' }] }),
          item({ citations: [{ sourceId: 'S2', quote: 'invented sentence about arbitration' }] }),
        ],
      }),
      [SOURCES[0]!, { ...SOURCES[1]!, truncated: true }],
    );
    expect(r.verification).toMatchObject({
      status: 'partially_verified',
      itemsVerified: 1,
      itemsUnverified: 1,
    });
    expect(r.verification.notes.join(' ')).toMatch(/truncated/);
  });
});

describe('unsupported legal authorities', () => {
  it('reports case names and statutory cites that no source contains', () => {
    const r = verifyOutput(
      'drafting',
      out({
        body: 'As held in Henderson v. Carlisle Holdings, and under 42 U.S.C. § 1983, the claim fails. See also § 12(b).',
      }),
      SOURCES,
    );
    expect(r.verification.unsupportedAuthorities).toEqual(
      expect.arrayContaining(['Henderson v. Carlisle Holdings']),
    );
    expect(r.verification.unsupportedAuthorities.join(' ')).toMatch(/1983/);
    expect(r.verification.notes.join(' ')).toMatch(
      /legal authorities that are not in the provided sources/,
    );
  });

  it('does not flag authorities that appear in the sources', () => {
    const sources = [
      src('S1', 'The claim relies on Henderson v. Carlisle Holdings and section 5 of the Act.'),
    ];
    expect(
      findUnsupportedAuthorities(['Henderson v. Carlisle Holdings is cited.'], sources),
    ).toEqual([]);
  });

  it('stays quiet for ordinary prose', () => {
    expect(
      findUnsupportedAuthorities(['The parties agreed on a twelve month term.'], SOURCES),
    ).toEqual([]);
  });
});

describe('parseModelOutput', () => {
  it('fills defaults and tolerates a fenced JSON block', () => {
    const o = parseModelOutput('```json\n{"body":"Hello"}\n```');
    expect(o).toMatchObject({ body: 'Hello', items: [], assumptions: [], answerable: true });
  });
  it('rejects non-JSON and wrong shapes', () => {
    expect(() => parseModelOutput('Sure! Here is a summary…')).toThrow();
    expect(() => parseModelOutput('{"items":"nope"}')).toThrow();
    expect(() => parseModelOutput('{"items":[{"risk":"catastrophic"}]}')).toThrow();
  });
});
