import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, safeEqual } from './crypto';

describe('crypto', () => {
  const key = 'k'.repeat(40);
  it('round-trips secrets and uses a fresh IV each time', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(a, key)).toBe('JBSWY3DPEHPK3PXP');
    expect(encryptSecret('JBSWY3DPEHPK3PXP', key)).not.toBe(a);
  });
  it('detects tampering and wrong keys', () => {
    const enc = encryptSecret('secret', key);
    expect(() => decryptSecret(enc, 'x'.repeat(40))).toThrow();
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });
  it('compares in constant time and handles length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
