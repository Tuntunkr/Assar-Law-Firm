import type { Metadata } from 'next';
import { Container } from '@assar/ui';
import { CourtPhoto } from '@/components/CourtPhoto';
import { PageHero } from '@/components/PageHero';
import { imagery, pageImagery } from '@/content/imagery';
import { site } from '@/content/site';

export const metadata: Metadata = {
  title: 'About',
  description: 'Assar Law Firm builds practice software where lawyers review every AI result.',
};

export default function Page() {
  return (
    <>
      <PageHero
        title="About Assar Law Firm"
        summary="Practice software for firms that want AI assistance and keep the decision with the lawyer."
        image={pageImagery.about}
      />
      <Container className="grid items-start gap-12 py-16 lg:grid-cols-[1fr_0.8fr]">
        <div className="max-w-3xl space-y-4 text-navy-800">
        <p>
          Assar is the practice platform for a law firm: clients and matters, hearings and tasks,
          documents, billing, and a client portal, in one workspace.
        </p>
        <p>
          AI summaries, chronologies and drafts are produced from documents the firm authorizes.
          Each result is labeled a draft until a lawyer reviews and approves it. Ask Assar does
          not give legal advice, and citations, facts and deadlines stay the lawyer’s to verify.
        </p>
        <p>
          Access follows the firm. Role-based permissions decide what staff can do. A restricted
          matter is visible only to the people named on it. Clients see only the matters and
          documents the firm has shared with them.
        </p>
        <p>
          Starter, Professional and Enterprise plans are listed on the pricing page. To talk about
          a rollout for your firm, write to{' '}
          <a className="font-medium text-accent-700 underline" href={`mailto:${site.contactEmail}`}>
            {site.contactEmail}
          </a>{' '}
          or book a demo.
        </p>
        </div>
        <CourtPhoto image={imagery.consultation} />
      </Container>
    </>
  );
}
