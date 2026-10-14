import type { Metadata } from 'next';
import { Container } from '@assar/ui';
import { DemoForm } from '@/components/DemoForm';
import { PageHero } from '@/components/PageHero';

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
      />
      <Container className="max-w-2xl py-16">
        <DemoForm />
      </Container>
    </>
  );
}
