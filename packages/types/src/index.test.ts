import { describe, expect, it } from 'vitest';
import { hasPermission, roleRequiresMfa, taxAmountCents, timeAmountCents } from './index.js';

describe('money helpers (integers only, half-up rounding)', () => {
  it('prices minutes at an hourly rate exactly', () => {
    expect(timeAmountCents(60, 25000)).toBe(25000);
    expect(timeAmountCents(30, 25000)).toBe(12500);
    expect(timeAmountCents(6, 25000)).toBe(2500); // 0.1 h, a classic floating-point trap
    expect(timeAmountCents(1, 25000)).toBe(417); // 416.67 -> 417
    expect(timeAmountCents(1, 10)).toBe(0); // 0.17 -> 0
    expect(timeAmountCents(3, 10)).toBe(1); // 0.5 rounds up
    expect(timeAmountCents(1440, 1_000_000)).toBe(24_000_000);
  });
  it('is stable for sums of many small entries (no drift)', () => {
    let total = 0;
    for (let i = 0; i < 1000; i++) total += timeAmountCents(7, 33333);
    expect(total).toBe(1000 * timeAmountCents(7, 33333));
  });
  it('computes tax in basis points, half up, for positive and negative amounts', () => {
    expect(taxAmountCents(10000, 825)).toBe(825);
    expect(taxAmountCents(1999, 825)).toBe(165); // 164.9175 -> 165
    expect(taxAmountCents(1, 5000)).toBe(1); // 0.5 -> 1
    expect(taxAmountCents(-10000, 825)).toBe(-825);
    expect(taxAmountCents(12345, 0)).toBe(0);
  });
  it('gives time entry logging to lawyers and paralegals, invoices to owner and the billing role', () => {
    expect(hasPermission('attorney', 'time:write')).toBe(true);
    expect(hasPermission('paralegal', 'time:write')).toBe(true);
    expect(hasPermission('staff', 'time:write')).toBe(false);
    expect(hasPermission('billing', 'billing:write')).toBe(true);
    expect(hasPermission('owner', 'billing:write')).toBe(true);
    expect(hasPermission('admin', 'billing:write')).toBe(false);
    expect(hasPermission('attorney', 'billing:read')).toBe(false);
    expect(roleRequiresMfa('billing')).toBe(true);
  });
});
