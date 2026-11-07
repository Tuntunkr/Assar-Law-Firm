import { describe, expect, it } from 'vitest';
import { daysPastDue, reminderMessage, reminderStep } from './reminders.js';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('daysPastDue', () => {
  it('counts whole calendar days, negative before the due date', () => {
    expect(daysPastDue(at('2026-03-10'), at('2026-03-10'))).toBe(0);
    expect(daysPastDue(at('2026-03-10'), at('2026-03-17'))).toBe(7);
    expect(daysPastDue(at('2026-03-10'), at('2026-03-07'))).toBe(-3);
    // Late evening on the due date is still the due date, not a day overdue.
    expect(daysPastDue(new Date('2026-03-10T00:30:00Z'), new Date('2026-03-10T23:59:00Z'))).toBe(0);
  });
});

describe('reminderStep', () => {
  const steps = [-3, 1, 7, 14, 30];
  it('returns the latest step reached, or null before the first', () => {
    expect(reminderStep(-10, steps)).toBeNull();
    expect(reminderStep(-3, steps)).toBe(-3);
    expect(reminderStep(0, steps)).toBe(-3);
    expect(reminderStep(1, steps)).toBe(1);
    expect(reminderStep(13, steps)).toBe(7);
    expect(reminderStep(400, steps)).toBe(30);
  });
  it('works with unsorted custom steps and an empty list', () => {
    expect(reminderStep(10, [14, 3, 7])).toBe(7);
    expect(reminderStep(10, [])).toBeNull();
  });
});

describe('reminderMessage', () => {
  const base = {
    clientName: 'Acme Holdings',
    invoiceNumber: 'INV-2026-00001',
    totalCents: 60891,
    balanceCents: 60891,
    currency: 'USD',
    dueAt: at('2026-03-10'),
    firmName: 'Smith & Co',
    senderName: 'Dana Owner',
  };
  it('is friendly before the due date and firmer when much later', () => {
    expect(reminderMessage({ ...base, daysPast: -3 })).toMatch(
      /friendly reminder .* falls due on 10 March 2026/,
    );
    expect(reminderMessage({ ...base, daysPast: 7 })).toContain('now 7 days overdue');
    expect(reminderMessage({ ...base, daysPast: 1 })).toContain('now 1 day overdue');
    expect(reminderMessage({ ...base, daysPast: 30 })).toContain('prompt attention');
  });
  it('states the remaining balance when partly paid, and signs off with the sender', () => {
    const m = reminderMessage({ ...base, daysPast: 7, balanceCents: 10000 });
    expect(m).toContain('$100.00 (the remaining balance of $608.91)');
    expect(m.trim().endsWith('Dana Owner\nSmith & Co')).toBe(true);
  });
});
