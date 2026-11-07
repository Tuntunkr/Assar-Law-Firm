import { Button, PageHeader, Stat, Table, Td, TextField, SelectField, Th } from '@assar/ui';
import { useState } from 'react';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { useAuth } from '../lib/auth';
import { formatMoney, startOfMonth, today } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const nextDay = (ymd: string) =>
  new Date(new Date(`${ymd}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
const BUCKETS: [keyof import('@assar/api-client').AgingDto['buckets'], string][] = [
  ['notYetDue', 'Not yet due'],
  ['days1to30', '1–30 days late'],
  ['days31to60', '31–60 days late'],
  ['days61to90', '61–90 days late'],
  ['over90', 'Over 90 days late'],
];

export function ReportsPage() {
  const { client } = useAuth();
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState('user');
  // The API treats `to` as exclusive, so the picked day is included by sending the next day.
  const q = { from, to: nextDay(to) };
  const valid = from <= to;
  const summary = useAsync(
    () => (valid ? client.billingSummary(q) : Promise.reject(new Error('range'))),
    [client, from, to, valid],
  );
  const time = useAsync(
    () => (valid ? client.timeReport({ ...q, groupBy }) : Promise.reject(new Error('range'))),
    [client, from, to, groupBy, valid],
  );
  const aging = useAsync(() => client.billingAging(), [client]);
  const s = summary.status === 'ready' ? summary.data : null;
  const num = (k: string) => (typeof s?.[k] === 'number' ? (s[k] as number) : 0);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Billing performance and time worked."
        actions={
          <a
            className="inline-flex h-11 items-center rounded-lg border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-900 hover:bg-navy-50"
            href={client.timeReportCsvUrl({ ...q, groupBy })}
          >
            Export time CSV
          </a>
        }
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <TextField
            id="rfrom"
            label="From"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="w-44">
          <TextField
            id="rto"
            label="To"
            type="date"
            value={to}
            min={from}
            max={today()}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="w-44">
          <SelectField
            id="rgroup"
            label="Group time by"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            <option value="user">Person</option>
            <option value="matter">Matter</option>
            <option value="client">Client</option>
          </SelectField>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setFrom(startOfMonth());
            setTo(today());
          }}
        >
          This month
        </Button>
      </div>
      {!valid && (
        <p role="alert" className="mb-4 text-sm font-medium text-red-700">
          “From” must not be after “To”.
        </p>
      )}
      {s && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Invoiced" value={formatMoney(num('invoicedCents'))} />
          <Stat label="Collected" value={formatMoney(num('collectedCents'))} tone="good" />
          <Stat label="Unbilled hours" value={s.unbilledHours.toFixed(1)} />
          <Stat label="Outstanding" value={formatMoney(num('outstandingCents'))} tone="warn" />
        </div>
      )}
      {s?.restrictedMattersExcluded && (
        <p className="mb-4 text-xs text-navy-600">
          Figures exclude restricted matters you cannot see.
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="timeh">
          <h2 id="timeh" className="mb-3 font-semibold text-navy-900">
            Time by {groupBy}
          </h2>
          <AsyncView
            state={time}
            onRetry={time.reload}
            skeleton={<div className="h-32 animate-pulse rounded-xl bg-navy-100" />}
            isEmpty={(r) => r.rows.length === 0}
            empty={<EmptyState title="No time in this range" />}
          >
            {(r) => (
              <Table>
                <thead>
                  <tr>
                    <Th>{groupBy}</Th>
                    <Th className="text-right">Hours</Th>
                    <Th className="text-right">Billable</Th>
                    <Th className="text-right">Billable value</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={x.key}>
                      <Td>{x.label ?? x.key}</Td>
                      <Td className="text-right tabular-nums">{x.hours.toFixed(2)}</Td>
                      <Td className="text-right tabular-nums">{x.billableHours.toFixed(2)}</Td>
                      <Td className="text-right tabular-nums">
                        {formatMoney(x.billableAmountCents)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </AsyncView>
        </section>
        <section aria-labelledby="ageh">
          <h2 id="ageh" className="mb-3 font-semibold text-navy-900">
            Receivables aging
          </h2>
          <AsyncView
            state={aging}
            onRetry={aging.reload}
            skeleton={<div className="h-32 animate-pulse rounded-xl bg-navy-100" />}
          >
            {(a) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Bucket</Th>
                    <Th className="text-right">Invoices</Th>
                    <Th className="text-right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {BUCKETS.map(([k, name]) => (
                    <tr key={k}>
                      <Td>{name}</Td>
                      <Td className="text-right tabular-nums">{a.buckets[k].count}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(a.buckets[k].cents)}</Td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <Td>Total</Td>
                    <Td />
                    <Td className="text-right tabular-nums">{formatMoney(a.totalCents)}</Td>
                  </tr>
                </tbody>
              </Table>
            )}
          </AsyncView>
        </section>
      </div>
    </>
  );
}
