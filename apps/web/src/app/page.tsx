import Link from 'next/link';
import { Badge, ButtonLink, Container, Section } from '@assar/ui';
import { DashboardPreview } from '@/components/DashboardPreview';
import { DemoForm } from '@/components/DemoForm';
import { FeatureGrid } from '@/components/FeatureGrid';
import { faqs } from '@/content/faq';
import { plans } from '@/content/pricing';
import {
  howItWorks,
  practiceAreas,
  productPages,
  securityPrinciples,
  services,
} from '@/content/services';
import { testimonials } from '@/content/testimonials';
import { site } from '@/content/site';

export default function HomePage() {
  const copilot = productPages['ai-legal-copilot']!;
  const mgmt = productPages['law-firm-management']!;
  const docs = productPages['document-intelligence']!;
  const flow = productPages['workflow-automation']!;
  return (
    <>
      <div className="bg-navy-950 text-white">
        <Container className="grid items-center gap-12 py-20 lg:grid-cols-2 lg:py-28">
          <div className="rise">
            <Badge className="bg-white/10 text-navy-100 ring-white/20">
              Built for lawyer-reviewed AI
            </Badge>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              Run your practice. Let AI draft. You decide.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-navy-200">{site.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/contact" size="lg">
                Book a Demo
              </ButtonLink>
              <ButtonLink href="#features" size="lg" variant="secondary">
                Explore Features
              </ButtonLink>
            </div>
          </div>
          <DashboardPreview />
        </Container>
      </div>

      <Section
        id="services"
        eyebrow="Services"
        title="Everything a modern practice needs"
        intro="Management, AI assistance, documents and automation in one platform."
      >
        <FeatureGrid items={services} />
      </Section>

      <Section id="features" tone="muted" eyebrow="AI Copilot" title={copilot.summary}>
        <FeatureGrid items={copilot.features} />
        {copilot.guardrail && (
          <p className="mt-6 max-w-3xl rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {copilot.guardrail}
          </p>
        )}
      </Section>

      <Section id="management" eyebrow="Case & client management" title={mgmt.summary}>
        <FeatureGrid items={mgmt.features} />
      </Section>

      <Section id="documents" tone="muted" eyebrow="Documents & contracts" title={docs.summary}>
        <FeatureGrid items={docs.features} cols={2} />
      </Section>

      <Section id="automation" eyebrow="Workflow automation" title={flow.summary}>
        <FeatureGrid items={flow.features} />
      </Section>

      <Section
        id="practice-areas"
        tone="muted"
        eyebrow="Use cases"
        title="Supported practice areas"
      >
        <FeatureGrid items={practiceAreas} />
      </Section>

      <Section
        id="security"
        tone="dark"
        eyebrow="Security & privacy"
        title="Designed around confidentiality"
        intro="These are the principles the platform is built to. We make no certification claims; ask us about current status."
      >
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {securityPrinciples.map((s) => (
            <li key={s.title} className="rounded-xl border border-navy-700 bg-navy-900 p-6">
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-navy-200">{s.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="how-it-works"
        eyebrow="How it works"
        title="From intake to reviewed work product"
      >
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {howItWorks.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-navy-100 p-6">
              <span className="text-sm font-semibold text-accent-600">Step {i + 1}</span>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-navy-700">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="pricing" tone="muted" eyebrow="Pricing" title="Plans that grow with your firm">
        <ul className="grid gap-5 lg:grid-cols-3">
          {plans.map((p) => (
            <li
              key={p.id}
              className={`rounded-xl border bg-white p-6 ${p.highlighted ? 'border-accent-500 ring-1 ring-accent-500' : 'border-navy-100'}`}
            >
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="text-sm text-navy-600">{p.audience}</p>
              <p className="mt-4 text-2xl font-semibold">
                {p.priceMonthly === null
                  ? 'Pricing on request'
                  : `${p.currency} ${p.priceMonthly}/mo`}
              </p>
              <ul className="mt-4 space-y-2 text-sm text-navy-700">
                {p.features.map((f) => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm">
          <Link href="/pricing" className="font-medium text-accent-700 underline">
            See pricing details
          </Link>
        </p>
      </Section>

      {testimonials.length > 0 && (
        <Section id="testimonials" title="What customers say">
          <ul className="grid gap-5 md:grid-cols-2">
            {testimonials.map((t) => (
              <li key={t.id} className="rounded-xl border border-navy-100 p-6">
                <blockquote>“{t.quote}”</blockquote>
                <p className="mt-3 text-sm text-navy-600">
                  {t.author}, {t.role}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        id="faq"
        tone={testimonials.length > 0 ? 'muted' : 'light'}
        eyebrow="FAQ"
        title="Common questions"
      >
        <div className="max-w-3xl divide-y divide-navy-100 rounded-xl border border-navy-100">
          {faqs.slice(0, 4).map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-accent-500">
                {f.q}
              </summary>
              <p className="mt-3 text-sm text-navy-700">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-sm">
          <Link href="/faq" className="font-medium text-accent-700 underline">
            All questions
          </Link>
        </p>
      </Section>

      <Section
        id="contact"
        tone="muted"
        eyebrow="Contact"
        title="Book a demo"
        intro="Tell us about your firm and we will follow up."
      >
        <div className="max-w-2xl">
          <DemoForm />
        </div>
      </Section>
    </>
  );
}
