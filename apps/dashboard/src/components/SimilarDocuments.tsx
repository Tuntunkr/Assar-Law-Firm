import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/useAsync';
import { AsyncView, EmptyState } from './AsyncView';

/** Other documents in the firm with similar wording (by shared vocabulary), most similar first. */
export function SimilarDocuments({ documentId }: { documentId: string }) {
  const { client } = useAuth();
  const state = useAsync(() => client.similarDocuments(documentId), [client, documentId]);
  return (
    <div className="rounded-xl border border-navy-100 bg-navy-50/40 p-4">
      <h3 className="mb-2 text-sm font-semibold text-navy-900">Similar documents</h3>
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={<div className="h-16 animate-pulse rounded bg-navy-100" />}
        isEmpty={(p) => p.data.length === 0}
        empty={
          <EmptyState title="Nothing similar found">
            No other readable document shares much wording with this one.
          </EmptyState>
        }
      >
        {(p) => (
          <ul className="divide-y divide-navy-100 text-sm">
            {p.data.map((d) => (
              <li
                key={d.documentId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <p className="font-medium text-navy-900">{d.title}</p>
                  <p className="text-xs text-navy-600">
                    {d.matter ? (
                      <Link
                        className="text-accent-700 hover:underline"
                        to={`/matters/${d.matter.id}`}
                      >
                        {d.matter.matterNumber} · {d.matter.title}
                      </Link>
                    ) : (
                      '—'
                    )}
                    {d.sharedTerms.length > 0 && (
                      <> · shares: {d.sharedTerms.slice(0, 5).join(', ')}</>
                    )}
                  </p>
                </div>
                <span
                  className="rounded-full bg-accent-500/10 px-2.5 py-0.5 text-xs font-semibold text-accent-700"
                  title="Cosine similarity of the two documents' words"
                >
                  {Math.round(d.similarity * 100)}% similar
                </span>
              </li>
            ))}
          </ul>
        )}
      </AsyncView>
    </div>
  );
}
