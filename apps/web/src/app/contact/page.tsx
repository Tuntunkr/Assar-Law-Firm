import type { Metadata } from 'next';
import { Container } from '@assar/ui';
import { DemoForm } from '@/components/DemoForm';
import { PageHero } from '@/components/PageHero';
import { pageImagery } from '@/content/imagery';
import { site } from '@/content/site';

export const metadata: Metadata = {
  title: 'Contact & Demo Booking',
  description: 'Book a demo of Assar Law Firm.',
};

export default function Page() {
  return (
    <>
      <PageHero
        title="Book a demo"
        summary="Tell us about your firm and we will follow up."
        cta={false}
        image={pageImagery.contact}
      />
      <Container className="max-w-2xl space-y-8 py-16">
        <p className="text-navy-800">
          Prefer email? Write to{' '}
          <a className="font-medium text-accent-700 underline" href={`mailto:${site.contactEmail}`}>
            {site.contactEmail}
          </a>
          .
        </p>
        <DemoForm />
      </Container>
    </>
  );
}
