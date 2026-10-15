import { ApiClientError, type DownloadLink } from '@assar/api-client';
import type { PortalDocument } from '@assar/types';
import { Alert, Badge, Button, Card, Skeleton } from '@assar/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { useNotify } from '../components/notify';
import { useAuth } from '../lib/auth';
import { AREA_LABEL, STATUS_LABEL, formatBytes, formatDate } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const sectionSkeleton = (
  <div className="space-y-3">
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-16 w-full" />
  </div>
);

/** Saves a signed link without navigating away from the portal. */
function startDownload(link: DownloadLink) {
  const a = document.createElement('a');
  a.href = link.url;
  a.download = link.filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function DocumentRow({ doc }: { doc: PortalDocument }) {
  const { client } = useAuth();
  const notify = useNotify();
  const [busy, setBusy] = useState<number | null>(null);

  async function download(version: number) {
    setBusy(version);
    try {
      startDownload(await client.downloadLink(doc.id, version));
    } catch (e) {
      notify(
        'error',
        e instanceof ApiClientError && e.status === 404
          ? 'That file is no longer available.'
          : 'The download could not be started. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <li>
      <Card>
        <h3 className="font-medium text-navy-900">{doc.title}</h3>
        <ul className="mt-2 divide-y divide-navy-100">
          {doc.versions.map((v) => (
            <li
              key={v.version}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span className="text-navy-700">
                {v.filename}{' '}
                <span className="text-navy-500">
                  · {formatBytes(v.sizeBytes)} · shared {formatDate(v.sharedAt)}
                  {doc.versions.length > 1 ? ` · version ${v.version}` : ''}
                </span>
              </span>
              <Button
                variant="secondary"
                loading={busy === v.version}
                onClick={() => download(v.version)}
                aria-label={`Download ${v.filename}`}
              >
                Download
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </li>
  );
}

export function MatterPage() {
  const { id = '' } = useParams();
  const { client } = useAuth();
  const matter = useAsync(() => client.getMatter(id), [client, id]);
  const docs = useAsync(() => client.listDocuments(id), [client, id]);
  const updates = useAsync(() => client.listAiOutputs(id), [client, id]);

  return (
    <>
      <p className="text-sm">
        <Link to="/" className="text-accent-700 underline">
          ← All matters
        </Link>
      </p>
      <AsyncView
        state={matter}
        onRetry={matter.reload}
        skeleton={<Skeleton className="mt-4 h-24 w-full" />}
      >
        {(m) => (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{m.title}</h1>
              <Badge>{STATUS_LABEL[m.status] ?? m.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-navy-600">
              {m.matterNumber} · {AREA_LABEL[m.practiceArea] ?? m.practiceArea} · Opened{' '}
              {formatDate(m.openedAt)}
              {m.closedAt ? ` · Closed ${formatDate(m.closedAt)}` : ''}
            </p>
            {m.note && (
              <div className="mt-4">
                <Alert tone="info">
                  <span className="font-medium">Message from your legal team: </span>
                  {m.note}
                </Alert>
              </div>
            )}

            <section aria-labelledby="docs-heading" className="mt-8">
              <h2 id="docs-heading" className="text-lg font-semibold text-navy-900">
                Documents
              </h2>
              <div className="mt-3">
                <AsyncView
                  state={docs}
                  onRetry={docs.reload}
                  skeleton={sectionSkeleton}
                  isEmpty={(d) => d.data.length === 0}
                  empty={
                    <EmptyState title="No documents shared yet">
                      Documents appear here when your law firm shares them.
                    </EmptyState>
                  }
                >
                  {(d) => (
                    <ul className="space-y-3">
                      {d.data.map((doc) => (
                        <DocumentRow key={doc.id} doc={doc} />
                      ))}
                    </ul>
                  )}
                </AsyncView>
              </div>
            </section>

            <section aria-labelledby="updates-heading" className="mt-8">
              <h2 id="updates-heading" className="text-lg font-semibold text-navy-900">
                Updates from your legal team
              </h2>
              <div className="mt-3">
                <AsyncView
                  state={updates}
                  onRetry={updates.reload}
                  skeleton={sectionSkeleton}
                  isEmpty={(d) => d.data.length === 0}
                  empty={
                    <EmptyState title="No updates yet">
                      Summaries your legal team has reviewed and shared will appear here.
                    </EmptyState>
                  }
                >
                  {(d) => (
                    <ul className="space-y-3">
                      {d.data.map((o) => (
                        <li key={o.id}>
                          <Card>
                            {o.title && <h3 className="font-medium text-navy-900">{o.title}</h3>}
                            {o.body.split(/\n{2,}/).map((p, i) => (
                              <p
                                key={i}
                                className="mt-2 whitespace-pre-line text-sm leading-6 text-navy-800"
                              >
                                {p}
                              </p>
                            ))}
                            {o.points.length > 0 && (
                              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-navy-800">
                                {o.points.map((p, i) => (
                                  <li key={i}>{p.text}</li>
                                ))}
                              </ul>
                            )}
                            <p className="mt-3 text-xs text-navy-600">
                              {o.label} · {formatDate(o.approvedAt)}
                            </p>
                          </Card>
                        </li>
                      ))}
                    </ul>
                  )}
                </AsyncView>
              </div>
            </section>
          </>
        )}
      </AsyncView>
    </>
  );
}
