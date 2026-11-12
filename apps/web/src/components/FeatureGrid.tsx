import type { Feature } from '@/content/services';

export function FeatureGrid({ items }: { items: Feature[]; cols?: 2 | 3 }) {
  return (
    <ul className="grid gap-x-16 md:grid-cols-2">
      {items.map((item) => (
        <li key={item.title} className="border-t border-[var(--line)] py-5">
          <h3 className="text-2xl leading-tight">{item.title}</h3>
          <p className="mt-2 max-w-[48ch] text-[15px] leading-relaxed text-[var(--muted)]">
            {item.body}
          </p>
        </li>
      ))}
    </ul>
  );
}
