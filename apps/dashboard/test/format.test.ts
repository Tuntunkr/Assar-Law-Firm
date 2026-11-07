import { describe, expect, it } from 'vitest';
import { formatMoney, parseDuration, parseMoneyToCents } from '../src/lib/format';

describe('parseMoneyToCents', () => {
  it('converts decimal strings without floating-point drift', () => {
    expect(parseMoneyToCents('125.50')).toBe(12550);
    expect(parseMoneyToCents('0.1')).toBe(10);
    expect(parseMoneyToCents('19.99')).toBe(1999);
    expect(parseMoneyToCents('-50')).toBe(-5000);
    expect(parseMoneyToCents(' 7 ')).toBe(700);
  });
  it('rejects anything that is not a plain amount', () => {
    for (const bad of ['', 'abc', '1.234', '1,000', '$5', '1e3', '--1'])
      expect(parseMoneyToCents(bad)).toBeNull();
  });
});

describe('parseDuration', () => {
  it('understands hours, h:mm and minutes', () => {
    expect(parseDuration('1.5')).toBe(90);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('45m')).toBe(45);
  });
  it('rejects nonsense', () => {
    for (const bad of ['', 'x', '1:75', '-1']) expect(parseDuration(bad)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats integer cents in the given currency', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
    expect(formatMoney(-500, 'USD')).toBe('-$5.00');
  });
});
