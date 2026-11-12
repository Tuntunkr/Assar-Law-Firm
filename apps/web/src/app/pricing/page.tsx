import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero } from '@/components/PageHero';
import { pageImagery } from '@/content/imagery';
import { formatPlanPrice, plans } from '@/content/pricing';

export const metadata: Metadata = { title: 'Pricing', description: 'Assar Law Firm plans.' };

export default function Page() {
  return (
    <>
      <PageHero
        title="Pricing"
        summary="Monthly prices in USD for the firm. Annual billing is arranged when you book a demo."
        cta={false}
        image={pageImagery.pricing}
      />
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="grid border border-[var(--line)] md:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className={`flex flex-col border-b border-[var(--line)] p-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 ${
                plan.highlighted ? 'bg-[var(--paper-2)]' : ''
              }`}
            >
              <h2 className="text-2xl">{plan.name}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{plan.audience}</p>
              <p className="mt-6 font-display text-4xl">{formatPlanPrice(plan)}</p>
              <ul className="mt-6 flex-1 space-y-2 text-sm leading-relaxed text-[var(--muted)]">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link href="/contact" className="site-btn mt-8">
                Book a demo
              </Link>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
