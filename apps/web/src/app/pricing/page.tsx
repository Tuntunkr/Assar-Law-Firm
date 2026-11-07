import type { Metadata } from 'next';
import { ButtonLink, Section } from '@assar/ui';
import { PageHero } from '@/components/PageHero';
import { plans } from '@/content/pricing';

export const metadata: Metadata = { title: 'Pricing', description: 'Assar Law Firm plans.' };

export default function Page() {
  return (
    <>
      <PageHero
        title="Pricing"
        summary="No price, tax rate, or plan is approved. The figures below are labels only. The demo form reaches a person only when a demo inbox is configured."
        cta={false}
      />
      <Section title="Plans">
        <ul className="grid gap-5 lg:grid-cols-3">
          {plans.map((p) => (
            <li
              key={p.id}
              className={`flex flex-col rounded-xl border p-6 ${p.highlighted ? 'border-accent-500 ring-1 ring-accent-500' : 'border-navy-100'}`}
            >
              <h2 className="text-xl font-semibold">{p.name}</h2>
              <p className="text-sm text-navy-600">{p.audience}</p>
              <p className="mt-4 text-2xl font-semibold">
                {p.priceMonthly === null
                  ? 'Pricing on request'
                  : `${p.currency} ${p.priceMonthly}/mo`}
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-navy-700">
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <ButtonLink
                href="/contact"
                className="mt-6"
                variant={p.highlighted ? 'primary' : 'secondary'}
              >
                Book a Demo
              </ButtonLink>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
