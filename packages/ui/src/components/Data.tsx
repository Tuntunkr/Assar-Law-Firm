'use client';

import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../cn';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-navy-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'warn' | 'good';
}) {
  const tones = { default: 'text-navy-900', warn: 'text-amber-700', good: 'text-emerald-700' };
  return (
    <div className="rounded-xl border border-navy-100 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-navy-500">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums', tones[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-navy-600">{hint}</p>}
    </div>
  );
}

const pills: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  blue: 'bg-accent-500/10 text-accent-700 ring-accent-500/30',
  gray: 'bg-navy-50 text-navy-700 ring-navy-100',
};
export type PillTone = keyof typeof pills;

export function StatusPill({ tone = 'gray', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1',
        pills[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative max-w-full min-w-0 overflow-x-auto rounded-xl border border-navy-100 bg-white shadow-sm">
      <table {...rest} className={cn('w-full text-left text-sm', className)} />
    </div>
  );
}
export const Th = ({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    scope="col"
    {...rest}
    className={cn(
      'whitespace-nowrap border-b border-navy-100 bg-navy-50/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-navy-600',
      className,
    )}
  />
);
export const Td = ({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td {...rest} className={cn('border-b border-navy-50 px-4 py-3 text-navy-900', className)} />
);

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-5 flex max-w-full min-w-0 gap-1 overflow-x-auto border-b border-navy-100"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
            value === t.id
              ? 'border-accent-600 text-accent-700'
              : 'border-transparent text-navy-600 hover:text-navy-900',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
