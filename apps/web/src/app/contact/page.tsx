import type { Metadata } from 'next';
import { Container } from '@assar/ui';
import { DemoForm } from '@/components/DemoForm';
import { PageHero } from '@/components/PageHero';

export const metadata: Metadata = {
  title: 'Demo',
  description:
    'Demo booking for Assar Law Firm software is shown only when an inbox is configured.',
};

export default function Page() {
  const demoConfigured = Boolean(process.env.DEMO_REQUEST_ENDPOINT);
  return (
    <>
      <PageHero
        title={demoConfigured ? 'Ask about a demo' : 'Demo booking is not configured'}
        summary={
          demoConfigured
            ? 'The form is sent to the inbox the firm has configured. It does not open a matter.'
            : 'No inbox is connected. This page does not collect a name or an email, and nothing is booked.'
        }
        cta={false}
      />
      <Container className="max-w-2xl py-16">
        {demoConfigured ? (
          <DemoForm />
        ) : (
          <div className="rounded-xl border border-navy-200 bg-white p-6" role="status">
            <h2 className="text-lg font-semibold text-navy-950">Nothing is booked</h2>
            <p className="mt-2 text-sm leading-6 text-navy-700">
              Demo booking needs an inbox the firm configures. Until then the form stays hidden.
              Staff can still use the sign-in.
            </p>
          </div>
        )}
      </Container>
    </>
  );
}
