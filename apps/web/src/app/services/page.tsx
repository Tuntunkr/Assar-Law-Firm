import type { Metadata } from 'next';
import { Section } from '@assar/ui';
import { FeatureGrid } from '@/components/FeatureGrid';
import { PageHero } from '@/components/PageHero';
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
        summary="The parts of the workspace a signed-in firm can use. A court feed and WhatsApp stay disconnected until the firm connects them."
      />
      <Section title="What we offer">
        <FeatureGrid items={services} />
      </Section>
    </>
  );
}
