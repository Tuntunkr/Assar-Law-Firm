import type { Metadata } from 'next';
import { Section } from '@assar/ui';
import { FeatureGrid } from '@/components/FeatureGrid';
import { PageHero } from '@/components/PageHero';

export const metadata: Metadata = {
  title: 'Solutions',
  description: 'How Assar Law Firm software organises a matter. Not a list of practice areas.',
};

const solutions = [
  {
    title: 'One matter record',
    body: 'The client, the people on the file, the documents and the tasks stay on the same matter.',
  },
  {
    title: 'A hearing the lawyer reviews',
    body: 'The note and the next date are drafts until a lawyer marks them reviewed. The court is not contacted.',
  },
  {
    title: 'Dates someone typed',
    body: 'Reminders stay inside the firm. The software does not apply a statute.',
  },
  {
    title: 'A message that waits',
    body: 'A client update is a preview until a lawyer approves it. WhatsApp sends only after the firm connects its own account.',
  },
  {
    title: 'An invoice the firm collects',
    body: 'The currency is chosen by the firm. Payment is recorded by a person. No tax rate is assumed.',
  },
  {
    title: 'A portal for that client',
    body: 'A client sees invoices and released messages on their own matters. Another client’s file stays hidden.',
  },
];

export default function Page() {
  return (
    <>
      <PageHero
        title="How a matter is kept"
        summary="These are parts of the software. They are not a list of practice areas, and they are not a promise of a result."
      />
      <Section title="The workspace">
        <FeatureGrid items={solutions} />
      </Section>
    </>
  );
}
