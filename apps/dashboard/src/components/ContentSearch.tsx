import { StatusPill } from '@assar/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/useAsync';
import { AsyncView, EmptyState } from './AsyncView';

/** Results of searching inside the text of documents, with the passage that matched. */
export function ContentSearch({
  query,
  clientId,
  onOpen,
}: {
  query: string;
  clientId?: string;
  onOpen: (documentId: string) => void;
}) {
  const { client } = useAuth();
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  const state = useAsync(
    () => client.searchDocumentText(debounced, { clientId: clientId || undefined, limit: 15 }),
    [client, debounced, clientId],
  );
  return (
    <AsyncView
      state={state}
      onRetry={state.reload}
      skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
      isEmpty={(r) => r.data.length === 0}
      empty={
        <EmptyState title="No document mentions that">
          Scanned files are searchable once their text has been read.
        </EmptyState>
      }
    >
      {(r) => (
        <ul className="divide-y divide-navy-50 rounded-xl border border-navy-100 bg-white">
          {r.data.map((h) => (
            <li key={h.documentId} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="font-medium text-accent-700 hover:underline"
                  onClick={() => onOpen(h.documentId)}
                >
                  {h.title}
                </button>
                <span className="flex items-center gap-2 text-xs text-navy-600">
                  {h.method === 'ocr' && <StatusPill tone="blue">scanned</StatusPill>}
                  {h.matter && (
                    <Link
                      className="text-accent-700 hover:underline"
                      to={`/matters/${h.matter.id}`}
                    >
                      {h.matter.matterNumber}
                    </Link>
                  )}
                </span>
              </div>
              <p className="mt-1 text-sm text-navy-700">{h.snippet}</p>
            </li>
          ))}
        </ul>
      )}
    </AsyncView>
  );
}
