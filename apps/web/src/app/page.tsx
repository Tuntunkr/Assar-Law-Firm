import Link from 'next/link';
import { ButtonLink, Container, Section } from '@assar/ui';
import { DashboardPreview } from '@/components/DashboardPreview';
import { DemoForm } from '@/components/DemoForm';
import { site } from '@/content/site';

const steps = [
  {
    title: 'Record the matter',
    body: 'A person types the court, the case number, a CNR if they have one, and a link. The CNR is checked for length and characters. No court is contacted.',
  },
  {
    title: 'Note the hearing',
    body: 'The outcome, the note, and a next date stay a draft until a lawyer marks them reviewed. The next date does not file anything.',
  },
  {
    title: 'Approve a date',
    body: 'Deadlines are dates someone typed, kept in Asia/Kolkata. The software does not apply the Limitation Act or any other statute.',
  },
  {
    title: 'Preview a client update',
    body: 'Email and WhatsApp text can be drafted and approved. Without a provider credential it is not sent. This site does not claim a template is approved.',
  },
];

const status = [
  ['Clients, matters, documents, tasks', 'In the software, for a signed-in firm'],
  ['Court name, CNR shape, official link, manual check', 'In the software. No court feed'],
  ['Hearing outcome with lawyer review', 'In the software. Dates are typed'],
  ['Intern role limited to assigned matters', 'In the software'],
  [
    'Invoices in INR or another chosen currency',
    'Drafts and manual payments. No tax rate is assumed',
  ],
  ['WhatsApp or email delivery', 'Not connected. Approval stops at a preview'],
  ['AI drafts', 'Off unless a firm turns them on. A lawyer still has to review them'],
];

export default function HomePage() {
  return (
    <>
      <div className="border-b border-amber-200 bg-amber-50">
        <Container className="py-3 text-sm text-amber-950">
          <p>
            <strong className="font-semibold">Review gate.</strong> Publishing this site is subject
            to advocate review. Bar Council of India Rule 36, as described in a 7 Nov 2026 search
            extract, restricts advertising and solicitation. That extract is not a certified copy of
            the rules. This page does not offer a result, a win rate, or a comparison that claims
            another product fails.
          </p>
        </Container>
      </div>

      <Container className="grid items-start gap-12 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:py-20">
        <div>
          <p className="support-in text-sm font-medium text-navy-600">Assar Law Firm</p>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-navy-950 sm:text-5xl">
            Software for the firm’s own matters.
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-lg text-navy-700">{site.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={site.dashboardUrl}>Open the staff sign-in</ButtonLink>
            <ButtonLink href="#status" variant="secondary">
              What is actually in the software
            </ButtonLink>
          </div>
        </div>
        <DashboardPreview />
      </Container>

      <Section id="status" eyebrow="Status" title="What this software does today">
        <div className="overflow-x-auto rounded-xl border border-navy-200">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Feature status of the Assar Law Firm software</caption>
            <thead className="bg-navy-50 text-navy-700">
              <tr>
                <th className="px-4 py-3 font-medium" scope="col">
                  Capability
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Status in this repository
                </th>
              </tr>
            </thead>
            <tbody>
              {status.map(([name, state]) => (
                <tr key={name} className="border-t border-navy-100">
                  <th className="px-4 py-3 font-medium text-navy-900" scope="row">
                    {name}
                  </th>
                  <td className="px-4 py-3 text-navy-700">{state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="workflow" tone="muted" eyebrow="Workflow" title="Four steps, all of them human">
        <ol className="grid gap-6 md:grid-cols-2">
          {steps.map((step, i) => (
            <li key={step.title} className="border-t border-navy-200 pt-4">
              <p className="text-sm font-medium text-navy-500">Step {i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold text-navy-950">{step.title}</h3>
              <p className="mt-2 text-pretty text-sm text-navy-700">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="sample" eyebrow="Sample" title="A labelled sample, not a client file">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-xl border border-navy-200 bg-white p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-500">
              Synthetic sample. Not a client matter.
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-navy-100 pb-3">
                <dt className="text-navy-600">Court</dt>
                <dd className="text-right font-medium text-navy-950">Typed by a user</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-navy-100 pb-3">
                <dt className="text-navy-600">CNR</dt>
                <dd className="text-right font-medium text-navy-950">Shape check only</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-navy-100 pb-3">
                <dt className="text-navy-600">Hearing</dt>
                <dd className="text-right font-medium text-navy-950">
                  Draft until a lawyer reviews it
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-navy-600">Client update</dt>
                <dd className="text-right font-medium text-navy-950">Preview. Not sent.</dd>
              </div>
            </dl>
          </div>
          <div className="text-sm text-navy-700">
            <p>
              The panel is an illustration of the software’s labels. It is not a filing, a cause
              list, or a client’s record. No advocate’s name, office, or result is shown because
              none is published here.
            </p>
            <p className="mt-4">
              <Link href="/about" className="font-medium text-navy-900 underline">
                Read what the firm has published about itself
              </Link>
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="contact"
        tone="muted"
        eyebrow="Demo"
        title="Ask about a demo"
        intro="The form reaches a person only when a demo inbox is configured. If it is not, the form shows that error. It does not create a filing or a client record."
      >
        <div className="max-w-2xl">
          <DemoForm />
        </div>
      </Section>
    </>
  );
}
