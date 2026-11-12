import type { Metadata } from 'next';
import { Section } from '@assar/ui';
import { FeatureGrid } from '@/components/FeatureGrid';
import { PageHero } from '@/components/PageHero';
import { pageImagery } from '@/content/imagery';
import { practiceAreas } from '@/content/services';

export const metadata: Metadata = {
  title: 'Solutions by Practice Area',
  description: 'How Assar supports different legal practice areas.',
};

export default function Page() {
  return (
    <>
      <PageHero
        title="Solutions by practice area"
        summary="Common workflows for the areas of law your firm handles."
        image={pageImagery.solutions}
      />
      <Section title="Practice areas">
        <FeatureGrid items={practiceAreas} />
      </Section>
    </>
  );
}
