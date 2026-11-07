import { describe, expect, it } from 'vitest';
import { BUILTIN_KEYS, extractPlaceholders, renderTemplate } from './templates.js';

describe('extractPlaceholders', () => {
  it('lists each key once, in order, tolerating spaces and ignoring malformed ones', () => {
    expect(
      extractPlaceholders(
        'Dear {{client.name}}, re {{ matter.title }} and {{client.name}} again; {{Bad Key}} {{1x}} {{ok_1}}',
      ),
    ).toEqual(['client.name', 'matter.title', 'ok_1']);
    expect(extractPlaceholders('no placeholders { {x} } {x}')).toEqual([]);
  });
});

describe('renderTemplate', () => {
  const values: Record<string, string> = { 'client.name': 'Acme Holdings', 'court.name': '' };
  it('fills known values and marks the rest visibly, listing them once', () => {
    const r = renderTemplate(
      'To {{client.name}} at {{court.name}} and {{court.name}} re {{x}}',
      (k) => values[k],
    );
    expect(r.text).toBe(
      'To Acme Holdings at [MISSING: court.name] and [MISSING: court.name] re [MISSING: x]',
    );
    expect(r.missing).toEqual(['court.name', 'x']);
  });

  it('does not expand placeholders found inside values (no recursion, no injection)', () => {
    const r = renderTemplate('Hello {{a}}', (k) => (k === 'a' ? '{{secret}} $& $1' : 'LEAKED'));
    expect(r.text).toBe('Hello {{secret}} $& $1');
    expect(r.missing).toEqual([]);
  });

  it('leaves text without placeholders unchanged', () => {
    expect(renderTemplate('Plain text.', () => 'x')).toEqual({ text: 'Plain text.', missing: [] });
  });
});

describe('built-in placeholders', () => {
  it('are all valid placeholder keys', () => {
    for (const k of BUILTIN_KEYS) expect(extractPlaceholders(`{{${k}}}`)).toEqual([k]);
  });
});
