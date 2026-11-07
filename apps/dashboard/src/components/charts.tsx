import { cn } from '@assar/ui';

/** Categorical palette (distinct in light and dark, in this order). */
export const SERIES = [
  '#6366f1',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#64748b',
];

export interface Slice {
  label: string;
  value: number;
  color?: string;
}

/** Donut chart with a legend. The legend doubles as the accessible data table. */
export function Donut({ data, label }: { data: Slice[]; label: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        viewBox="0 0 200 200"
        className="h-48 w-48"
        role="img"
        aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}
      >
        <circle
          cx="100"
          cy="100"
          r={R}
          fill="none"
          stroke="currentColor"
          className="text-navy-100"
          strokeWidth="28"
        />
        {total > 0 &&
          data.map((d, i) => {
            const len = (d.value / total) * C;
            const el = (
              <circle
                key={d.label}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={d.color ?? SERIES[i % SERIES.length]}
                strokeWidth="28"
                strokeDasharray={`${Math.max(len - 1.5, 0)} ${C - Math.max(len - 1.5, 0)}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 100 100)"
              />
            );
            offset += len;
            return el;
          })}
        <text
          x="100"
          y="96"
          textAnchor="middle"
          className="fill-navy-900 text-[28px] font-semibold"
        >
          {total}
        </text>
        <text x="100" y="116" textAnchor="middle" className="fill-navy-500 text-[11px]">
          total
        </text>
      </svg>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-navy-700">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: d.color ?? SERIES[i % SERIES.length] }}
            />
            {d.label} <span className="tabular-nums text-navy-500">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical bars with gridlines. Values are counts, so the axis uses whole numbers. */
export function Bars({
  data,
  label,
  className,
}: {
  data: Slice[];
  label: string;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const top = Math.max(2, Math.ceil(max / 2) * 2);
  const W = 420;
  const H = 220;
  const pad = { l: 28, r: 8, t: 8, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = Math.min(56, (iw / data.length) * 0.5);
  const ticks = [0, top / 4, top / 2, (top * 3) / 4, top].map((t) => Math.round(t));
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn('h-56 w-full', className)}
      role="img"
      aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}
    >
      {[...new Set(ticks)].map((t) => {
        const y = pad.t + ih - (t / top) * ih;
        return (
          <g key={t}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-navy-100"
              strokeDasharray="3 3"
            />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-navy-500 text-[10px]">
              {t}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = pad.l + (iw / data.length) * (i + 0.5) - bw / 2;
        const h = (d.value / top) * ih;
        return (
          <g key={d.label}>
            <rect
              x={x}
              y={pad.t + ih - h}
              width={bw}
              height={h}
              rx="4"
              fill={d.color ?? SERIES[i % SERIES.length]}
            />
            <text
              x={x + bw / 2}
              y={pad.t + ih - h - 4}
              textAnchor="middle"
              className="fill-navy-700 text-[10px] font-medium"
            >
              {d.value > 0 ? d.value : ''}
            </text>
            <text
              x={x + bw / 2}
              y={H - 8}
              textAnchor="middle"
              className="fill-navy-600 text-[11px]"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
