import { Badge, Card, Skeleton } from '@assar/ui';
import { Link } from 'react-router-dom';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { useAuth } from '../lib/auth';
import { AREA_LABEL, STATUS_LABEL, formatDate } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export function MattersPage() {
  const { client } = useAuth();
  const matters = useAsync(() => client.listMatters(), [client]);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Your matters</h1>
      <div className="mt-6">
        <AsyncView
          state={matters}
          onRetry={matters.reload}
          skeleton={
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          }
          isEmpty={(d) => d.data.length === 0}
          empty={
            <EmptyState title="No matters have been shared with you yet">
              Your law firm will share a matter here when it is ready for you to see.
            </EmptyState>
          }
        >
          {(d) => (
            <ul className="space-y-3">
              {d.data.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/matters/${m.id}`}
                    className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                  >
                    <Card>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-semibold text-navy-900">{m.title}</h2>
                        <Badge>{STATUS_LABEL[m.status] ?? m.status}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-navy-600">
                        {m.matterNumber} · {AREA_LABEL[m.practiceArea] ?? m.practiceArea} · Opened{' '}
                        {formatDate(m.openedAt)}
                      </p>
                      {m.note && <p className="mt-2 text-sm text-navy-800">{m.note}</p>}
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </AsyncView>
      </div>
    </>
  );
}
