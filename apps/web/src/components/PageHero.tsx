import Link from 'next/link';
import type { CourtImage } from '@/content/imagery';
import { CourtPhoto } from '@/components/CourtPhoto';

export function PageHero({
  title,
  summary,
  cta = true,
  image,
}: {
  title: string;
  summary: string;
  cta?: boolean;
  image?: CourtImage;
}) {
  return (
    <section className="border-b border-[var(--line)]">
      <div
        className={
          image
            ? 'mx-auto grid max-w-6xl items-end gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-16'
            : 'mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-16'
        }
      >
        <div>
          <h1 className="max-w-[16ch] text-4xl leading-[1.12] sm:max-w-xl sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-[46ch] text-lg leading-relaxed text-[var(--muted)]">{summary}</p>
          {cta && (
            <Link href="/contact" className="site-btn mt-8">
              Book a demo
            </Link>
          )}
        </div>
        {image && <CourtPhoto image={image} priority />}
      </div>
    </section>
  );
}
