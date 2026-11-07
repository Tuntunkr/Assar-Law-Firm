import type { Metadata } from 'next';
import { Container } from '@assar/ui';
import { PageHero } from '@/components/PageHero';

export const metadata: Metadata = { title: 'About', description: 'About Assar Law Firm.' };

export default function Page() {
  return (
    <>
      <PageHero
        title="About Assar Law Firm"
        summary="Practice software where AI assists and lawyers decide."
      />
      <Container className="max-w-3xl space-y-4 py-16 text-navy-800">
        <p>
          We are building a practice management platform that combines everyday case and client
          management with AI assistance that is transparent about its limits.
        </p>
        <p>
          Our principles: AI output is always a draft until a lawyer reviews it; clients and staff
          only see what they are authorized to see; and confidential material is handled with care.
        </p>
        <p>
          No office address, advocate roster, or case result is published on this site. Pricing is
          not published. A public page is not a representation that every court or message provider
          is connected.
        </p>
      </Container>
    </>
  );
}
