import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export function Container({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn('mx-auto w-full max-w-6xl px-5 sm:px-8', className)} />;
}

export function Section({
  id,
  eyebrow,
  title,
  intro,
  tone = 'light',
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  tone?: 'light' | 'muted' | 'dark';
  children?: ReactNode;
}) {
  const tones = {
    light: 'bg-white text-navy-900',
    muted: 'bg-navy-50 text-navy-900',
    dark: 'bg-navy-950 text-white',
  };
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn('py-20 sm:py-24', tones[tone])}
    >
      <Container>
        <div className="max-w-2xl">
          {eyebrow && (
            <p
              className={cn(
                'text-sm font-semibold uppercase tracking-wider',
                tone === 'dark' ? 'text-accent-400' : 'text-accent-600',
              )}
            >
              {eyebrow}
            </p>
          )}
          <h2
            id={id ? `${id}-title` : undefined}
            className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            {title}
          </h2>
          {intro && (
            <p className={cn('mt-4 text-lg', tone === 'dark' ? 'text-navy-200' : 'text-navy-700')}>
              {intro}
            </p>
          )}
        </div>
        {children && <div className="mt-12">{children}</div>}
      </Container>
    </section>
  );
}
