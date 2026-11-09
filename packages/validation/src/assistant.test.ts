import { describe, expect, it } from 'vitest';
import { sendAssistantMessageSchema } from './index.js';

describe('sendAssistantMessageSchema', () => {
  it('rejects an empty message and a message over 2000 characters', () => {
    expect(sendAssistantMessageSchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(sendAssistantMessageSchema.safeParse({ body: 'a'.repeat(2001) }).success).toBe(false);
    expect(sendAssistantMessageSchema.safeParse({ body: 'Where are invoices?' }).success).toBe(true);
  });
});
