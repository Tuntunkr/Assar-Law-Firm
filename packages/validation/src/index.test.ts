import { describe, expect, it } from 'vitest';
import { demoRequestSchema, loginSchema, paginationSchema } from './index.js';

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
