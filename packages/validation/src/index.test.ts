import { describe, expect, it } from 'vitest';
import { demoRequestSchema, loginSchema, paginationSchema, weakSecretReason } from './index.js';

describe('validation', () => {
  it('normalizes login email', () => {
    expect(loginSchema.parse({ email: ' A@B.com ', password: 'x' }).email).toBe('a@b.com');
  });
  it('caps pagination limit', () => {
    expect(paginationSchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(paginationSchema.parse({}).limit).toBe(25);
  });
  it('requires consent on demo requests', () => {
    const base = { name: 'Jo Doe', email: 'jo@firm.com', firm: 'Firm LLP', firmSize: '6-20' };
    expect(demoRequestSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...base, consent: true }).success).toBe(true);
  });
});

describe('weakSecretReason', () => {
  it('rejects placeholders, short, repetitive and low-variety secrets', () => {
    expect(weakSecretReason('short')).toMatch(/shorter than 32/);
    expect(weakSecretReason('change-me-min-32-chars-change-me-min-32')).toMatch(/placeholder/);
    expect(weakSecretReason('a'.repeat(40))).toMatch(/few distinct|repeated/);
    expect(weakSecretReason('abcabcabcabcabcabcabcabcabcabcabcabcabc')).toBeTruthy();
    expect(weakSecretReason('my-test-secret-for-the-session-cookie-1')).toMatch(/placeholder/);
    expect(weakSecretReason('0000000000111111111122222222223333')).toBeTruthy();
  });
  it('accepts random-looking secrets', () => {
    expect(weakSecretReason('k9Qw3vT7nXz2LpA8sDf6HgJ4mBc1RyUe')).toBeNull();
    expect(weakSecretReason('R7vU2yTq0nWk5bHx9ZsJ4dGc8LmPe1Af6QoXi3Nt')).toBeNull();
  });
  it('honours a custom minimum length', () => {
    expect(weakSecretReason('k9Qw3vT7nXz2LpA8', 16)).toBeNull();
    expect(weakSecretReason('k9Qw3vT7nXz2', 16)).toMatch(/shorter than 16/);
  });
});
