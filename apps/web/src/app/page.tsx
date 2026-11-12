import Link from 'next/link';
import { CourtPhoto } from '@/components/CourtPhoto';
import { DemoForm } from '@/components/DemoForm';
import { imagery } from '@/content/imagery';
import { faqs } from '@/content/faq';
import { formatPlanPrice, plans } from '@/content/pricing';
import { howItWorks, practiceAreas, services } from '@/content/services';

export default function HomePage() {
  return (
    <>
      <section className="border-b border-[var(--line)]">
        <div className="mx-auto grid max-w-6xl items-end gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
          <div>
            <h1 className="max-w-[12ch] text-4xl leading-[1.08] sm:text-5xl lg:text-6xl">
              Drafts wait for counsel.
            </h1>
            <p className="mt-5 max-w-[38ch] text-lg leading-relaxed text-[var(--muted)]">
              Matters, hearings, and documents in one workspace. Nothing goes to a client until a
              lawyer approves it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/contact" className="site-btn">
                Book a demo
              </Link>
              <Link href="/pricing" className="site-btn site-btn-ghost">
                See pricing
              </Link>
            </div>
          </div>
          <CourtPhoto image={imagery.highCourt} priority />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-16 sm:px-8 lg:grid-cols-[1.4fr_0.8fr] lg:py-20">
        <CourtPhoto
          image={imagery.districtCourt}
          sizes="(min-width: 1024px) 58vw, 100vw"
        />
        <div className="grid gap-8">
          <CourtPhoto image={imagery.advocate} sizes="(min-width: 1024px) 28vw, 100vw" />
          <CourtPhoto image={imagery.corridor} sizes="(min-width: 1024px) 28vw, 100vw" />
        </div>
      </section>

      <section id="services" className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <h2 className="max-w-[16ch] text-3xl sm:text-4xl">What the firm actually uses</h2>
          <p className="mt-4 max-w-[52ch] text-[var(--muted)]">
            One workspace for the matter file, the hearing list, and the draft that still needs a
            name on it.
          </p>
          <ul className="mt-10 grid gap-x-16 md:grid-cols-2">
            {services.map((item) => (
              <li key={item.title} className="border-t border-[var(--line)] py-5">
                <h3 className="text-2xl">{item.title}</h3>
                <p className="mt-2 max-w-[46ch] text-[15px] leading-relaxed text-[var(--muted)]">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm text-[var(--muted)]">
            {practiceAreas.map((area) => area.title).join(', ')}.
          </p>
          <Link href="/services" className="mt-6 inline-block text-sm underline">
            All services
          </Link>
        </div>
      </section>

      <section className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <h2 className="text-3xl sm:text-4xl">How a matter moves</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {howItWorks.map((step) => (
              <li key={step.title} className="border-t border-[var(--line)] pt-4">
                <h3 className="text-xl">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="pricing" className="border-t border-[var(--line)] bg-[var(--paper-2)]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <h2 className="text-3xl sm:text-4xl">Monthly, for the firm</h2>
          <p className="mt-4 max-w-[46ch] text-[var(--muted)]">
            Prices are in USD. Annual billing is arranged on a call.
          </p>
          <div className="mt-10 grid border border-[var(--line)] bg-[var(--surface)] md:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.id}
                className={`border-b border-[var(--line)] p-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 ${
                  plan.highlighted ? 'bg-[var(--paper)]' : ''
                }`}
              >
                <h3 className="text-2xl">{plan.name}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{plan.audience}</p>
                <p className="mt-6 font-display text-4xl">{formatPlanPrice(plan)}</p>
                <ul className="mt-6 space-y-2 text-sm leading-relaxed text-[var(--muted)]">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <Link href="/pricing" className="mt-6 inline-block text-sm underline">
            See pricing
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-start gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:py-20">
        <div>
          <h2 className="text-3xl sm:text-4xl">The rule that does not move</h2>
          <p className="mt-4 max-w-[36ch] leading-relaxed text-[var(--muted)]">
            Ask Assar is not a lawyer. Citations, facts, and deadlines stay yours to check.
          </p>
        </div>
        <ul className="border-t border-[var(--line)]">
          <li className="border-b border-[var(--line)] py-5 text-xl leading-snug">
            A summary stays a draft until a lawyer approves it.
          </li>
          <li className="border-b border-[var(--line)] py-5 text-xl leading-snug">
            A restricted matter is visible only to the people named on it.
          </li>
          <li className="border-b border-[var(--line)] py-5 text-xl leading-snug">
            Clients see only the documents the firm has shared.
          </li>
        </ul>
      </section>

      <section id="faq" className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:grid lg:grid-cols-[0.7fr_1.3fr] lg:py-20">
          <h2 className="text-3xl sm:text-4xl">Questions partners ask</h2>
          <div className="mt-8 border-t border-[var(--line)] lg:mt-0">
            {faqs.slice(0, 4).map((item) => (
              <details key={item.q} className="border-b border-[var(--line)] py-4">
                <summary className="cursor-pointer text-lg">{item.q}</summary>
                <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-[var(--muted)]">
                  {item.a}
                </p>
              </details>
            ))}
            <Link href="/faq" className="mt-6 inline-block text-sm underline">
              All questions
            </Link>
          </div>
        </div>
      </section>

      <section id="contact" className="border-t border-[var(--line)]">
        <div className="mx-auto grid max-w-6xl items-start gap-12 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:py-20">
          <div>
            <h2 className="text-3xl sm:text-4xl">Book a demo</h2>
            <p className="mt-4 max-w-[40ch] leading-relaxed text-[var(--muted)]">
              Tell us the size of the firm and which court list you run. We will reply by email.
            </p>
            <div className="mt-8">
              <DemoForm />
            </div>
          </div>
          <CourtPhoto image={imagery.consultation} />
        </div>
      </section>
    </>
  );
}
