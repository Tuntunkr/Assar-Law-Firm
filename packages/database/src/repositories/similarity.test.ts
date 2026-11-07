import { describe, expect, it } from 'vitest';
import { keyTerms, similarity, tokenize } from './work.js';

const LEASE_A =
  'Commercial lease between Acme Holdings and Landlord Limited. The tenant shall pay monthly rent for the premises. ' +
  'The landlord shall repair the heating and ventilation equipment. Rent increases annually. Termination requires written notice.';
const LEASE_B =
  'Lease agreement for commercial premises. Monthly rent payable by tenant; landlord repairs ventilation and heating systems. ' +
  'Written notice is required for termination of the lease.';
const NDA =
  'Mutual confidentiality agreement. Each recipient must protect proprietary information disclosed, and return materials on request.';

describe('tokenize', () => {
  it('lower-cases, drops short and very common words, and keeps non-English letters', () => {
    expect(tokenize('The Tenant SHALL pay Rent, and the rent is due')).toEqual([
      'tenant',
      'rent',
      'rent',
    ]);
    expect(tokenize('किराया समझौता और नोटिस')).toEqual(['किराया', 'समझौता', 'नोटिस']);
  });
});

describe('similarity', () => {
  it('is high for two leases, low for a lease and an NDA, and 1 for identical text', () => {
    const lease = similarity(LEASE_A, LEASE_B);
    const different = similarity(LEASE_A, NDA);
    expect(lease.score).toBeGreaterThan(0.25);
    expect(different.score).toBeLessThan(0.1);
    expect(lease.score).toBeGreaterThan(different.score * 3);
    expect(similarity(LEASE_A, LEASE_A).score).toBeCloseTo(1, 5);
  });

  it('reports (at most eight of) the words both documents contain', () => {
    const { shared } = similarity(LEASE_A, LEASE_B);
    expect(shared.length).toBeGreaterThan(3);
    expect(shared.length).toBeLessThanOrEqual(8);
    for (const w of shared) {
      expect(tokenize(LEASE_A)).toContain(w);
      expect(tokenize(LEASE_B)).toContain(w);
    }
  });

  it('handles empty input without dividing by zero', () => {
    expect(similarity('', LEASE_A)).toEqual({ score: 0, shared: [] });
    expect(similarity('', '').score).toBe(0);
  });
});

describe('keyTerms', () => {
  it('picks the most frequent meaningful words', () => {
    expect(keyTerms('rent rent rent tenant tenant landlord the and', 2)).toEqual([
      'rent',
      'tenant',
    ]);
  });
});
