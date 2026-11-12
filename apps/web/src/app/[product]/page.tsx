import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Section } from '@assar/ui';
import { FeatureGrid } from '@/components/FeatureGrid';
import { PageHero } from '@/components/PageHero';
import { pageImagery } from '@/content/imagery';
import { productPages } from '@/content/services';

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(productPages).map((product) => ({ product }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ product: string }>;
}): Promise<Metadata> {
  const { product } = await params;
  const page = productPages[product];
  return page
    ? { title: page.title, description: page.summary, alternates: { canonical: `/${page.slug}` } }
    : {};
}

export default async function ProductPage({ params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  const page = productPages[product];
  if (!page) notFound();
  return (
    <>
      <PageHero title={page.title} summary={page.summary} image={pageImagery[page.slug]} />
      <Section title="Capabilities">
        <FeatureGrid items={page.features} />
        {page.guardrail && (
          <p className="mt-8 max-w-3xl rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {page.guardrail}
          </p>
        )}
      </Section>
    </>
  );
}
