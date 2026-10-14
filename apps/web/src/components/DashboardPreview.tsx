/** Illustrative mockup only. All names and figures are synthetic. */
const rows = [
  { m: 'Sample Matter A', s: 'Active', d: 'Hearing – synthetic date' },
  { m: 'Sample Matter B', s: 'Review', d: 'Draft awaiting approval' },
  { m: 'Sample Matter C', s: 'Active', d: 'Task due this week' },
];

export function DashboardPreview() {
  return (
    <figure className="rise">
      <div className="overflow-hidden rounded-2xl border border-navy-200 bg-white shadow-xl">
        <div
          className="flex items-center gap-1.5 border-b border-navy-100 bg-navy-50 px-4 py-3"
          aria-hidden="true"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-navy-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-navy-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-navy-200" />
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-[180px_1fr]">
          <div className="hidden space-y-2 text-sm text-navy-700 sm:block" aria-hidden="true">
            {['Overview', 'Matters', 'Clients', 'Documents', 'Calendar', 'AI Reviews'].map(
              (i, idx) => (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 ${idx === 1 ? 'bg-navy-900 text-white' : ''}`}
                >
                  {i}
                </div>
              ),
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-navy-900">Matters</p>
            <ul className="mt-3 divide-y divide-navy-100 rounded-lg border border-navy-100">
              {rows.map((r) => (
                <li key={r.m} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="font-medium text-navy-900">{r.m}</span>
                  <span className="hidden text-navy-600 sm:inline">{r.d}</span>
                  <span className="rounded-full bg-accent-500/10 px-2.5 py-0.5 text-xs font-medium text-accent-700">
                    {r.s}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Draft – unverified.</strong> AI summary awaiting attorney review.
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-navy-600">
        Illustrative preview using synthetic data.
      </figcaption>
    </figure>
  );
}
