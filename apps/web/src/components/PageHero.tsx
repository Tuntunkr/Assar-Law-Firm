import { ButtonLink, Container } from '@assar/ui';

export function PageHero({
  title,
  summary,
  cta = true,
}: {
  title: string;
  summary: string;
  cta?: boolean;
}) {
  return (
    <div className="bg-navy-950 text-white">
      <Container className="py-20 sm:py-24">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-lg text-navy-200">{summary}</p>
        {cta && (
          <div className="mt-8">
            <ButtonLink href="/contact" size="lg">
              Book a Demo
            </ButtonLink>
          </div>
        )}
      </Container>
    </div>
  );
}
