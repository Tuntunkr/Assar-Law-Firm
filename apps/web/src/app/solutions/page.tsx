import type { Metadata } from 'next';
import { Section } from '@assar/ui';
import { FeatureGrid } from '@/components/FeatureGrid';
import { PageHero } from '@/components/PageHero';
import { practiceAreas } from '@/content/services';

export const metadata: Metadata = {
  title: 'Solutions by Practice Area',
  description:
    'Examples of records the software can store. Not a list of the firm’s practice areas.',
};

export default function Page() {
  return (
    <>
      <PageHero
        title="Records the software can hold"
        summary="These are examples of files the software can store. They are not a list of Assar Law Firm’s practice areas. No practice area, office, or result is published here."
      />
      <Section title="Practice areas">
        <FeatureGrid items={practiceAreas} />
      </Section>
    </>
  );
}
