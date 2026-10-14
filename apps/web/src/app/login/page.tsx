import type { Metadata } from 'next';
import { ButtonLink, Card, Container } from '@assar/ui';
import { PageHero } from '@/components/PageHero';
import { site } from '@/content/site';

export const metadata: Metadata = { title: 'Login', robots: { index: false } };

export default function Page() {
  return (
    <>
      <PageHero title="Login" summary="Choose where you are signing in." cta={false} />
      <Container className="grid max-w-3xl gap-5 py-16 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Law firm team</h2>
          <p className="mt-2 text-sm text-navy-700">Attorneys and staff.</p>
          <ButtonLink href={site.dashboardUrl} className="mt-4">
            Open dashboard
          </ButtonLink>
        </Card>
        <Card>
          <h2 className="font-semibold">Client portal</h2>
          <p className="mt-2 text-sm text-navy-700">Clients of a firm using Assar.</p>
          <ButtonLink href={site.clientPortalUrl} variant="secondary" className="mt-4">
            Open client portal
          </ButtonLink>
        </Card>
      </Container>
    </>
  );
}
