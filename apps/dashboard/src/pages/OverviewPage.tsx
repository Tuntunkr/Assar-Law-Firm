import type { AuditLogDto } from '@assar/api-client';
import { PRACTICE_AREAS } from '@assar/types';
import { Skeleton, StatusPill } from '@assar/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { Bars, Donut, SERIES } from '../components/charts';
import { Icon, type IconName } from '../components/Icon';
import { useAuth, useMe } from '../lib/auth';
import {
  AREA_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  isOverdue,
  label,
  toneOf,
} from '../lib/format';
import { usePeople } from '../lib/people';
import { useAsync } from '../lib/useAsync';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const weekAhead = () => {
  const from = new Date();
  return { from: from.toISOString(), to: new Date(from.getTime() + 7 * 86_400_000).toISOString() };
};
const WEEK = 7 * 86_400_000;
const recent = (iso: string) => Date.now() - new Date(iso).getTime() < WEEK;

function StatCard({
  title,
  value,
  hint,
  hintTone = 'muted',
  icon,
  tint,
  to,
}: {
  title: string;
  value: ReactNode;
  hint: string;
  hintTone?: 'good' | 'bad' | 'muted';
  icon: IconName;
  tint: string;
  to: string;
}) {
  const tones = { good: 'text-emerald-600', bad: 'text-red-600', muted: 'text-navy-500' };
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-navy-100 bg-white p-5 shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-navy-700">{title}</p>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${tint}`}>
          <Icon name={icon} size={18} />
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tabular-nums text-navy-900">{value}</p>
      <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${tones[hintTone]}`}>
        {hint}
      </p>
    </Link>
  );
}

function Panel({
  title,
  to,
  linkText = 'View all',
  children,
}: {
  title: string;
  to?: string;
  linkText?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-navy-900">{title}</h2>
        {to && (
          <Link to={to} className="text-sm inline-flex min-h-11 items-center font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500">
            {linkText}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const ACTION_LABEL = (a: string) => label(a.replace('.', ' · '));

export function OverviewPage() {
  const { client, can } = useAuth();
  const me = useMe();
  const { name } = usePeople();
  const data = useAsync(async () => {
    const w = weekAhead();
    const [clients, matters, tasks, events, drafts, aging, activity] = await Promise.all([
      can('client:read') ? client.clients({ limit: 100, status: 'active' }) : null,
      can('matter:read') ? client.matters({ limit: 100 }) : null,
      can('task:write') ? client.tasks({ limit: 100 }) : null,
      can('calendar:write') ? client.events({ ...w, limit: 6 }) : null,
      can('ai:use') ? client.aiOutputs({ reviewStatus: 'draft', limit: 5 }) : null,
      can('billing:read') ? client.billingAging().catch(() => null) : null,
      can('audit:read') ? client.auditLogs({ limit: 6 }).catch(() => null) : null,
    ]);
    return { clients, matters, tasks, events, drafts, aging, activity };
  }, [client]);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-navy-900">
            {greeting()}, {me.user.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-navy-600">Here's what's happening at your firm today.</p>
        </div>
        <p className="text-sm text-navy-500">
          {new Date().toLocaleDateString('en', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>
      <AsyncView
        state={data}
        onRetry={data.reload}
        skeleton={
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
        }
      >
        {({ clients, matters, tasks, events, drafts, aging, activity }) => {
          const openTasks = (tasks?.data ?? []).filter(
            (t) => t.status !== 'done' && t.status !== 'cancelled',
          );
          const overdue = openTasks.filter((t) => isOverdue(t.dueAt, t.status));
          const activeMatters = (matters?.data ?? []).filter((m) => m.status === 'open');
          const more = (p: { page: { nextCursor: string | null } } | null) =>
            p?.page.nextCursor ? '+' : '';
          const byArea = PRACTICE_AREAS.map((a, i) => ({
            label: AREA_LABEL[a] ?? a,
            value: activeMatters.filter((m) => m.practiceArea === a).length,
            color: SERIES[i % SERIES.length],
          })).filter((s) => s.value > 0);
          const byStatus = [
            {
              label: 'Todo',
              value: (tasks?.data ?? []).filter((t) => t.status === 'todo').length,
              color: '#6366f1',
            },
            {
              label: 'In progress',
              value: (tasks?.data ?? []).filter((t) => t.status === 'in_progress').length,
              color: '#f59e0b',
            },
            {
              label: 'Done',
              value: (tasks?.data ?? []).filter((t) => t.status === 'done').length,
              color: '#10b981',
            },
          ];
          return (
            <div className="space-y-8">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {clients && (
                  <StatCard
                    title="Total clients"
                    value={`${clients.data.length}${more(clients)}`}
                    hint={`${clients.data.filter((c) => recent(c.createdAt)).length} new this week`}
                    hintTone="good"
                    icon="clients"
                    tint="bg-blue-50 text-blue-600"
                    to="/clients"
                  />
                )}
                {matters && (
                  <StatCard
                    title="Active matters"
                    value={`${activeMatters.length}${more(matters)}`}
                    hint={`${activeMatters.filter((m) => recent(m.createdAt)).length} new this week`}
                    hintTone="good"
                    icon="matters"
                    tint="bg-indigo-50 text-indigo-600"
                    to="/matters"
                  />
                )}
                {tasks && (
                  <StatCard
                    title="Pending tasks"
                    value={openTasks.length}
                    hint={overdue.length ? `${overdue.length} overdue` : 'None overdue'}
                    hintTone={overdue.length ? 'bad' : 'muted'}
                    icon="tasks"
                    tint="bg-emerald-50 text-emerald-600"
                    to="/tasks"
                  />
                )}
                {aging ? (
                  <StatCard
                    title="Receivables"
                    value={formatMoney(aging.totalCents)}
                    hint="Unpaid issued invoices"
                    icon="dollar"
                    tint="bg-amber-50 text-amber-600"
                    to="/invoices"
                  />
                ) : drafts ? (
                  <StatCard
                    title="AI drafts to review"
                    value={drafts.data.length}
                    hint="Waiting for an attorney"
                    icon="ai"
                    tint="bg-amber-50 text-amber-600"
                    to="/ai"
                  />
                ) : null}
              </div>

              <div>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-navy-500">
                  Quick actions
                </h2>
                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    can('client:write') && {
                      to: '/clients?new=1',
                      t: 'New client',
                      d: 'Add a new client to your roster',
                      i: 'userPlus' as const,
                    },
                    can('matter:write') && {
                      to: '/matters?new=1',
                      t: 'New matter',
                      d: 'Open a new legal matter',
                      i: 'plus' as const,
                    },
                    can('time:write') && {
                      to: '/time?new=1',
                      t: 'Log time',
                      d: 'Record billable time on a matter',
                      i: 'time' as const,
                    },
                  ]
                    .filter(Boolean)
                    .map((a) => {
                      const x = a as { to: string; t: string; d: string; i: IconName };
                      return (
                        <Link
                          key={x.to}
                          to={x.to}
                          className="flex items-center gap-4 rounded-2xl border border-navy-100 bg-white p-4 shadow-sm transition hover:shadow-md"
                        >
                          <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
                            <Icon name={x.i} size={20} />
                          </span>
                          <span>
                            <span className="block font-semibold text-navy-900">{x.t}</span>
                            <span className="block text-sm text-navy-600">{x.d}</span>
                          </span>
                        </Link>
                      );
                    })}
                </div>
              </div>

              {(matters || tasks) && (
                <div className="grid gap-5 lg:grid-cols-2">
                  {matters && (
                    <Panel title="Matters by practice area" to="/matters">
                      {byArea.length ? (
                        <Donut data={byArea} label="Active matters by practice area" />
                      ) : (
                        <EmptyState title="No active matters" />
                      )}
                    </Panel>
                  )}
                  {tasks && (
                    <Panel title="Tasks by status" to="/tasks">
                      <Bars data={byStatus} label="Tasks by status" />
                    </Panel>
                  )}
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-2">
                {activity && (
                  <Panel title="Recent activity" to="/audit">
                    {activity.data.length === 0 ? (
                      <EmptyState title="No activity yet" />
                    ) : (
                      <ul className="divide-y divide-navy-50 text-sm">
                        {activity.data.map((a: AuditLogDto) => (
                          <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                            <span className="truncate">
                              <span className="font-medium text-navy-900">
                                {a.actorId ? name(a.actorId) : a.actorType}
                              </span>{' '}
                              <span className="text-navy-600">{ACTION_LABEL(a.action)}</span>
                            </span>
                            <span className="shrink-0 text-xs text-navy-500">
                              {formatDateTime(a.createdAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                )}
                {events && (
                  <Panel title="Upcoming events" to="/calendar" linkText="Calendar">
                    {events.data.length === 0 ? (
                      <EmptyState title="No events in the next 7 days" />
                    ) : (
                      <ul className="divide-y divide-navy-50 text-sm">
                        {events.data.map((e) => (
                          <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                            <span className="truncate font-medium text-navy-900">
                              {e.title} <StatusPill tone={toneOf(e.kind)}>{e.kind}</StatusPill>
                            </span>
                            <span className="shrink-0 text-xs text-navy-500">
                              {formatDateTime(e.startsAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                )}
                {tasks && overdue.length > 0 && (
                  <Panel title="Overdue work" to="/tasks">
                    <ul className="divide-y divide-navy-50 text-sm">
                      {overdue.slice(0, 5).map((t) => (
                        <li key={t.id} className="flex justify-between gap-3 py-2.5">
                          <span className="truncate">{t.title}</span>
                          <span className="shrink-0 font-medium text-red-600">
                            {formatDate(t.dueAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
                {drafts && drafts.data.length > 0 && (
                  <Panel title="AI drafts waiting for review" to="/ai" linkText="Open queue">
                    <ul className="divide-y divide-navy-50 text-sm">
                      {drafts.data.map((d) => (
                        <li key={d.id} className="flex justify-between py-2.5">
                          <span className="capitalize">{label(d.task)}</span>
                          <span className="text-xs text-navy-500">
                            {formatDateTime(d.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
              </div>
            </div>
          );
        }}
      </AsyncView>
    </>
  );
}
