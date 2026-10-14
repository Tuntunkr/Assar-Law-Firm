import { describe, expect, it } from 'vitest';
import { parseReply } from './scan.provider';

describe('clamd reply parsing', () => {
  it('maps OK, FOUND and errors', () => {
    expect(parseReply('stream: OK\0')).toEqual({ status: 'clean', engine: 'clamav' });
    expect(parseReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      status: 'infected',
      engine: 'clamav',
      signature: 'Win.Test.EICAR_HDB-1',
    });
    expect(() => parseReply('INSTREAM size limit exceeded. ERROR\0')).toThrow(
      /Unexpected clamd reply/,
    );
    expect(() => parseReply('')).toThrow(/Unexpected clamd reply/);
  });
});
