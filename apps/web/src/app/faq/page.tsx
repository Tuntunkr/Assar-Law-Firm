import type { Metadata } from 'next';
import { Container } from '@assar/ui';
import { PageHero } from '@/components/PageHero';
import { faqs } from '@/content/faq';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Frequently asked questions about Assar Law Firm.',
};

export default function Page() {
  return (
    <>
      <PageHero
        title="Frequently asked questions"
        summary="Straight answers about AI, access and security."
      />
      <Container className="max-w-3xl py-16">
        <div className="divide-y divide-navy-100 rounded-xl border border-navy-100">
          {faqs.map((f) => (
            <details key={f.q} className="p-5">
              <summary className="cursor-pointer font-medium">{f.q}</summary>
              <p className="mt-3 text-sm text-navy-700">{f.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </>
  );
}
