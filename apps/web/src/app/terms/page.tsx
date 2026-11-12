import type { Metadata } from 'next';
import { Container } from '@assar/ui';
import { LegalDraftNotice } from '@/components/LegalDraftNotice';
import { PageHero } from '@/components/PageHero';
import { pageImagery } from '@/content/imagery';

export const metadata: Metadata = { title: 'Terms of Service', robots: { index: false } };

export default function Page() {
  return (
    <>
      <PageHero
        title="Terms of Service"
        summary="Draft. Pending legal review."
        cta={false}
        image={pageImagery.terms}
      />
      <Container className="max-w-3xl space-y-6 py-16">
        <LegalDraftNotice />
        <p className="text-navy-700">
          The final Terms of Service will be published here after review by qualified counsel.
        </p>
      </Container>
    </>
  );
}
