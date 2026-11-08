import { ButtonLink, Container, Section } from '@assar/ui';
import { DemoForm } from '@/components/DemoForm';
import { site } from '@/content/site';

const steps = [
  {
    title: 'Keep the matter in one place',
    body: 'Clients, documents, tasks and the people working on a file sit together. An intern sees a matter only after someone assigns them work on it.',
  },
  {
    title: 'Write down the hearing',
    body: 'The result, the note and the next date stay a draft until a lawyer reviews them. The next date is the one a person typed. It does not file anything.',
  },
  {
    title: 'Approve a date before anyone is reminded',
    body: 'Dates are kept in India time. A reminder stays inside the firm until a lawyer has approved the date. The software does not calculate a limitation period.',
  },
  {
    title: 'Read a client update before it can leave',
    body: 'Email and WhatsApp text wait for a lawyer. WhatsApp is off until the firm connects it. A saved template name is not an approval from Meta.',
  },
];

const capabilities = [
  ['Clients, matters, documents and tasks', 'Available to a signed-in firm'],
  ['Court name, case number and an official link', 'Typed by a person. No court feed is connected'],
  ['Hearing notes and the next date', 'A lawyer reviews them. Nothing is filed'],
  ['Dates and in-firm reminders', 'Someone types the date. India time'],
  ['Invoices in rupees or another chosen currency', 'The firm records payment. No tax is assumed'],
  ['Client portal', 'Invoices and released messages for that client only'],
  ['WhatsApp', 'Built, and switched off until the firm adds its own keys'],
  ['AI drafts', 'Off unless the firm turns them on. A lawyer still reviews them'],
];

export default function HomePage() {
  const demoLocal = process.env.DEMO_BOOKING === 'local';
  const demoConfigured = demoLocal || Boolean(process.env.DEMO_REQUEST_ENDPOINT);
  return (
    <>
      <Container className="grid items-center gap-12 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-24">
        <div>
          <p className="support-in text-sm font-medium tracking-wide text-navy-600">
            Assar Law Firm
          </p>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-navy-950 sm:text-5xl">
            A calm place for the work of the firm.
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-lg leading-8 text-navy-700">
            Staff keep clients, documents, dates and invoices together. Court entries are typed and
            checked by a person. A message to a client waits until a lawyer has read it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={site.dashboardUrl}>Staff sign-in</ButtonLink>
            <ButtonLink href="#work" variant="secondary">
              How the work is kept
            </ButtonLink>
          </div>
        </div>
        <figure className="overflow-hidden rounded-2xl border border-navy-200 bg-white shadow-sm">
          <img
            src="/product-dates.png"
            alt="The dates screen in the staff workspace. The matter is a synthetic sample, and the date is a draft someone typed."
            width={1440}
            height={900}
            className="h-auto w-full"
          />
          <figcaption className="border-t border-navy-100 px-4 py-3 text-sm text-navy-600">
            A screenshot of the working dates screen. The matter name is synthetic. It is not a
            client file.
          </figcaption>
        </figure>
      </Container>

      <Section
        id="work"
        eyebrow="The work"
        title="What a person does, and what the software does not"
      >
        <ol className="grid gap-8 md:grid-cols-2">
          {steps.map((step, i) => (
            <li key={step.title} className="border-t border-navy-200 pt-4">
              <p className="text-sm font-medium text-navy-500">{i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold text-navy-950">{step.title}</h3>
              <p className="mt-2 text-pretty text-sm leading-6 text-navy-700">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="capabilities"
        tone="muted"
        eyebrow="Capabilities"
        title="What is ready, and what is still connected by the firm"
      >
        <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">What the Assar Law Firm software can do today</caption>
            <thead className="bg-navy-50 text-navy-700">
              <tr>
                <th className="px-4 py-3 font-medium" scope="col">
                  Capability
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  How it stands
                </th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map(([name, state]) => (
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

      <Section id="sample" eyebrow="The screen" title="The workspace, with a synthetic matter">
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <figure className="overflow-hidden rounded-2xl border border-navy-200 bg-white">
            <img
              src="/product-updates.png"
              alt="The client updates screen before any preview has been drafted. The firm name in the sidebar is a synthetic preview."
              width={1440}
              height={900}
              className="h-auto w-full"
            />
            <figcaption className="border-t border-navy-100 px-4 py-3 text-sm text-navy-600">
              The client-update screen, empty. A lawyer still has to approve a preview before it can
              leave the firm.
            </figcaption>
          </figure>
          <div className="text-sm leading-6 text-navy-700">
            <p>
              These pictures are the real screens, filled with a sample that was typed for the
              preview. They are not a filing, a cause list, or a client’s record.
            </p>
            <p className="mt-4">
              No advocate, office, result or fee is shown, because none is published with this page.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="contact"
        tone="muted"
        eyebrow="Demo"
        title="Ask about a demo"
        intro={
          demoLocal
            ? 'The form is saved on this computer. No email is sent and no calendar is written.'
            : demoConfigured
              ? 'The form is sent to the inbox the firm has configured. It does not open a matter or a filing.'
              : 'Demo booking is not configured. The form is hidden so a name and an email are not collected into nowhere.'
        }
      >
        <div className="max-w-2xl">
          {demoConfigured ? (
            <DemoForm mode={demoLocal ? 'local' : 'inbox'} />
          ) : (
            <div className="rounded-xl border border-navy-200 bg-white p-6" role="status">
              <h3 className="text-lg font-semibold text-navy-950">
                Demo booking is not configured
              </h3>
              <p className="mt-2 text-sm leading-6 text-navy-700">
                No inbox is connected, so this page does not ask for a name or an email. Nothing is
                booked. Staff can still open the sign-in.
              </p>
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
