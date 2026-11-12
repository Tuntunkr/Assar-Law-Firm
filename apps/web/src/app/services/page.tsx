import type { Metadata } from 'next';
import { Section } from '@assar/ui';
import { FeatureGrid } from '@/components/FeatureGrid';
import { PageHero } from '@/components/PageHero';
import { pageImagery } from '@/content/imagery';
import { services } from '@/content/services';

export const metadata: Metadata = {
  title: 'Services',
  description: 'All Assar Law Firm services.',
};

export default function Page() {
  return (
    <>
      <PageHero
        title="Services"
        summary="Practice management, AI assistance, documents and automation."
        image={pageImagery.services}
      />
      <Section title="What we offer">
        <FeatureGrid items={services} />
      </Section>
    </>
  );
}
