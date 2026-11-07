import { describe, expect, it } from 'vitest';
import {
  cnrProblem,
  decideDelivery,
  istDate,
  istDaysUntil,
  isStaleVerification,
  webhookHostProblem,
} from './practice.js';

describe('practice dates and gates', () => {
  it('checks CNR shape and does not invent a lookup', () => {
    expect(cnrProblem('DLHC010012342026')).toBeNull();
    expect(cnrProblem('short')).toMatch(/shape only/);
  });

  it('counts Kolkata calendar days without applying a statute', () => {
    const morning = new Date('2026-11-07T02:30:00.000Z'); // 08:00 IST
    expect(istDate(morning)).toBe('2026-11-07');
    expect(istDaysUntil('2026-11-10', morning)).toBe(3);
    expect(istDaysUntil('2026-11-06', morning)).toBe(-1);
  });

  it('marks a verification stale after seven days', () => {
    const now = new Date('2026-11-14T12:00:00.000Z');
    expect(isStaleVerification('2026-11-07T11:00:00.000Z', now)).toBe(true);
    expect(isStaleVerification('2026-11-10T12:00:00.000Z', now)).toBe(false);
    expect(isStaleVerification(null, now)).toBe(false);
  });

  it('refuses example.com as a live webhook and does not pretend to send', () => {
    expect(webhookHostProblem('https://n8n.example.com/webhook/assar')).toBe('example-host');
    expect(webhookHostProblem('https://hooks.internal.example/assar')).toBeNull();
    expect(decideDelivery('mock').status).toBe('mock_delivered');
    expect(decideDelivery('unconfigured').status).toBe('external_activation_gate');
  });
});
