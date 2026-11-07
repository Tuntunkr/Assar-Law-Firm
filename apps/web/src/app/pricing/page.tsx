import type { Metadata } from 'next';
import { Section } from '@assar/ui';
import { PageHero } from '@/components/PageHero';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'No price is published for the Assar Law Firm software.',
};

const included = [
  'Clients, matters, documents and tasks for a signed-in firm',
  'Hearing notes and typed dates, reviewed by a lawyer',
  'Invoices in a currency the firm chooses, with payment recorded by hand',
  'A client portal for that client’s invoices and released messages',
  'WhatsApp prepared in the software and left off until the firm adds its own keys',
];

export default function Page() {
  return (
    <>
      <PageHero
        title="Pricing"
        summary="No price, plan or tax is published. This page does not take a payment and it does not quote a fee."
        cta={false}
      />
      <Section title="What the software contains">
        <div className="max-w-2xl rounded-xl border border-navy-200 bg-white p-6">
          <h2 className="text-xl font-semibold text-navy-950">No price is published</h2>
          <p className="mt-2 text-sm leading-6 text-navy-700">
            There is no monthly fee, setup fee or rupee amount on this page. A figure here would be
            invented, so none is shown.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-navy-800">
            {included.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </Section>
    </>
  );
}
