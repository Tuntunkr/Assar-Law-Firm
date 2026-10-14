import { Card } from '@assar/ui';
import type { Feature } from '@/content/services';

export function FeatureGrid({ items, cols = 3 }: { items: Feature[]; cols?: 2 | 3 }) {
  return (
    <ul className={`grid gap-5 sm:grid-cols-2 ${cols === 3 ? 'lg:grid-cols-3' : ''}`}>
      {items.map((f) => (
        <li key={f.title}>
          <Card className="h-full">
            <h3 className="text-base font-semibold text-navy-900">{f.title}</h3>
            <p className="mt-2 text-sm leading-6 text-navy-700">{f.body}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
