import type { AiOutputDto } from '@assar/api-client';
import { Button, SelectField, StatusPill, Table, Tabs, Td, Th } from '@assar/ui';
import { useState } from 'react';
import { AiReviewModal } from '../components/AiReviewModal';
import { EmptyState } from '../components/AsyncView';
import { PagedView } from '../components/Pager';
import { useAuth } from '../lib/auth';
import { formatDateTime, label, toneOf } from '../lib/format';
import { useAction } from '../lib/useAction';
import { usePaged } from '../lib/usePaged';

/** Document drafts and the jobs that produce them. Shown inside Ask Assar for roles with ai:use. */
export function AiPage() {
  const [tab, setTab] = useState<'review' | 'jobs'>('review');
  return (
    <>
      <Tabs
        label="AI sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'review', label: 'Review queue' },
          { id: 'jobs', label: 'Jobs' },
        ]}
      />
      {tab === 'review' ? <Review /> : <Jobs />}
    </>
  );
}

function Review() {
  const { client } = useAuth();
  const [status, setStatus] = useState('draft');
  const [open, setOpen] = useState<AiOutputDto | null>(null);
  const paged = usePaged(
    (cursor) => client.aiOutputs({ reviewStatus: status || undefined, cursor, limit: 25 }),
    [client, status],
  );
  return (
    <>
      <div className="mb-4 w-48">
        <SelectField
          id="rs"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="draft">Waiting for review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </SelectField>
      </div>
      <PagedView
        paged={paged}
        empty={
          <EmptyState title="Nothing to review">
            Run an AI task from a matter to create drafts.
          </EmptyState>
        }
      >
        {(items: AiOutputDto[]) => (
          <Table>
            <thead>
              <tr>
                <Th>Task</Th>
                <Th>Title</Th>
                <Th>Created</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <Td className="capitalize">{label(o.task)}</Td>
                  <Td>{(o.result as { title?: string } | null)?.title ?? '—'}</Td>
                  <Td>{formatDateTime(o.createdAt)}</Td>
                  <Td>
                    <StatusPill tone={toneOf(o.reviewStatus)}>{o.reviewStatus}</StatusPill>
                  </Td>
                  <Td className="text-right">
                    <Button variant="secondary" onClick={() => setOpen(o)}>
                      {o.reviewStatus === 'draft' ? 'Review' : 'View'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PagedView>
      {open && (
        <AiReviewModal
          output={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            paged.reload();
          }}
        />
      )}
    </>
  );
}

function Jobs() {
  const { client } = useAuth();
  const act = useAction();
  const paged = usePaged((cursor) => client.aiJobs({ cursor, limit: 25 }), [client]);
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="secondary" onClick={paged.reload}>
          Refresh
        </Button>
      </div>
      <PagedView paged={paged} empty={<EmptyState title="No AI jobs yet" />}>
        {(items) => (
          <Table>
            <thead>
              <tr>
                <Th>Task</Th>
                <Th>Status</Th>
                <Th>Stage</Th>
                <Th>Attempts</Th>
                <Th>Created</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((j) => (
                <tr key={j.id}>
                  <Td className="capitalize">{label(j.task)}</Td>
                  <Td>
                    <StatusPill tone={toneOf(j.status)}>{j.status}</StatusPill>
                    {j.error && (
                      <p
                        className="mt-1 max-w-xs truncate text-xs text-red-700"
                        title={j.error.message}
                      >
                        {j.error.message}
                      </p>
                    )}
                  </Td>
                  <Td>{j.stage ? label(j.stage) : '—'}</Td>
                  <Td>
                    {j.attempts}/{j.maxAttempts}
                  </Td>
                  <Td>{formatDateTime(j.createdAt)}</Td>
                  <Td className="text-right">
                    {(j.status === 'queued' || j.status === 'processing') && (
                      <Button
                        variant="ghost"
                        disabled={act.busy}
                        onClick={async () => {
                          if (await act.run(() => client.cancelAiJob(j.id), 'Cancel requested'))
                            paged.reload();
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                    {j.status === 'failed' && (
                      <Button
                        variant="ghost"
                        disabled={act.busy}
                        onClick={async () => {
                          if (await act.run(() => client.retryAiJob(j.id), 'Job re-queued'))
                            paged.reload();
                        }}
                      >
                        Retry
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PagedView>
    </>
  );
}
