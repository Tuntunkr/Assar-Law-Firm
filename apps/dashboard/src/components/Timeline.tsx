import type { TimelineEntryDto } from '@assar/api-client';
import { Alert, Button, Skeleton } from '@assar/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { usePeople } from '../lib/people';
import { errorText } from '../lib/useAction';
import { EmptyState } from './AsyncView';
import { Icon, type IconName } from './Icon';

const ICON: Record<string, { icon: IconName; tint: string }> = {
  'matter.opened': { icon: 'matters', tint: 'bg-indigo-50 text-indigo-600' },
  'matter.closed': { icon: 'check', tint: 'bg-slate-100 text-slate-600' },
  'document.added': { icon: 'documents', tint: 'bg-blue-50 text-blue-600' },
  'document.version': { icon: 'upload', tint: 'bg-blue-50 text-blue-600' },
  'task.created': { icon: 'tasks', tint: 'bg-emerald-50 text-emerald-600' },
  'task.completed': { icon: 'check', tint: 'bg-emerald-50 text-emerald-600' },
  'invoice.issued': { icon: 'invoices', tint: 'bg-amber-50 text-amber-600' },
  'invoice.paid': { icon: 'dollar', tint: 'bg-emerald-50 text-emerald-600' },
  'ai.approved': { icon: 'ai', tint: 'bg-violet-50 text-violet-600' },
  'ai.rejected': { icon: 'ai', tint: 'bg-red-50 text-red-600' },
  'party.added': { icon: 'clients', tint: 'bg-cyan-50 text-cyan-600' },
};
const FALLBACK = { icon: 'calendar' as IconName, tint: 'bg-red-50 text-red-600' };
const LINK: Record<string, (id: string) => string> = {
  matter: (id) => `/matters/${id}`,
  invoice: (id) => `/invoices/${id}`,
  ai_output: () => '/ai',
};

/** A history of what happened on one matter, or across all of a client's matters. */
export function Timeline({ scope, id }: { scope: 'matter' | 'client'; id: string }) {
  const { client } = useAuth();
  const { name } = usePeople();
  const [items, setItems] = useState<TimelineEntryDto[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'more' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (before?: string) => {
      setState(before ? 'more' : 'loading');
      try {
        const q = { limit: 30, before };
        const p =
          scope === 'matter'
            ? await client.matterTimeline(id, q)
            : await client.clientTimeline(id, q);
        setItems((cur) => (before ? [...cur, ...p.data] : p.data));
        setNext(p.page.nextBefore);
        setState('ready');
      } catch (e) {
        setError(e);
        setState('error');
      }
    },
    [client, scope, id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading')
    return (
      <div aria-busy="true" aria-label="Loading" className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  if (state === 'error' && items.length === 0)
    return (
      <div className="space-y-3">
        <Alert tone="error">{errorText(error)}</Alert>
        <Button variant="secondary" onClick={() => load()}>
          Try again
        </Button>
      </div>
    );
  if (items.length === 0)
    return (
      <EmptyState title="No history yet">
        Activity appears here as work happens on this {scope}.
      </EmptyState>
    );

  return (
    <div>
      <ol className="relative ml-4 space-y-5 border-l border-navy-100 pl-8">
        {items.map((e, i) => {
          const style = ICON[e.type] ?? FALLBACK;
          const to = e.ref && LINK[e.ref.type]?.(e.ref.id);
          return (
            <li key={`${e.type}-${e.at}-${i}`} className="relative">
              <span
                className={`absolute -left-[3.05rem] grid h-9 w-9 place-items-center rounded-full ${style.tint}`}
              >
                <Icon name={style.icon} size={16} />
              </span>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className="font-medium text-navy-900">{e.title}</p>
                <time dateTime={e.at} className="text-xs text-navy-500">
                  {formatDateTime(e.at)}
                </time>
              </div>
              {e.detail && (
                <p className="text-sm text-navy-700">
                  {to ? (
                    <Link className="text-accent-700 hover:underline" to={to}>
                      {e.detail}
                    </Link>
                  ) : (
                    e.detail
                  )}
                </p>
              )}
              {e.actorId && <p className="text-xs text-navy-500">by {name(e.actorId)}</p>}
            </li>
          );
        })}
      </ol>
      {next && (
        <div className="mt-6 text-center">
          <Button variant="secondary" loading={state === 'more'} onClick={() => load(next)}>
            Show older
          </Button>
        </div>
      )}
    </div>
  );
}
