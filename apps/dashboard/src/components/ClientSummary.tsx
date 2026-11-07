import type { AiJobDto, AiOutputDto } from '@assar/api-client';
import { Alert, Button, Card, StatusPill, TextAreaField } from '@assar/ui';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { formatDateTime, label, toneOf } from '../lib/format';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';
import { AiReviewModal } from './AiReviewModal';
import { AsyncView, EmptyState } from './AsyncView';

const TERMINAL = ['succeeded', 'failed', 'cancelled'];
const STAGE: Record<string, string> = {
  extracting_text: 'Reading the case file…',
  generating: 'Writing the summary…',
  saving: 'Saving…',
};

/** AI summary of a client's whole case history. Private to the person who asked for it. */
export function ClientSummary({ clientId }: { clientId: string }) {
  const { client } = useAuth();
  const act = useAction();
  const [focus, setFocus] = useState('');
  const [job, setJob] = useState<AiJobDto | null>(null);
  const [open, setOpen] = useState<AiOutputDto | null>(null);
  const past = useAsync(() => client.aiOutputs({ clientId, limit: 10 }), [client, clientId]);

  // Follow the job until it finishes; the status shown is what the worker is really doing.
  useEffect(() => {
    if (!job || TERMINAL.includes(job.status)) return;
    const t = setInterval(async () => {
      try {
        const j = await client.aiJob(job.id);
        setJob(j);
        if (TERMINAL.includes(j.status)) past.reload();
      } catch {
        /* keep polling; a transient error should not lose the job */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [client, job, past]);

  const running = !!job && !TERMINAL.includes(job.status);
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="space-y-3 lg:col-span-2">
        <h2 className="font-semibold text-navy-900">Summarise this client's case history</h2>
        <p className="text-sm text-navy-700">
          Reads every matter you can see for this client, with court details and recent history, and
          drafts an overview. Matters you cannot see are never included.
        </p>
        <Alert tone="info">
          Summaries are private to you, because they may mention matters your colleagues cannot
          access. Every summary is an AI draft until you review it.
        </Alert>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const j = await act.run(
              () =>
                client.createClientSummary({
                  clientId,
                  ...(focus.trim() ? { instructions: focus.trim() } : {}),
                }),
              'Summary requested',
            );
            if (j) setJob(j);
          }}
        >
          <TextAreaField
            id="focus"
            label="Focus (optional)"
            rows={2}
            placeholder="e.g. what is still outstanding?"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            error={act.errors.instructions}
          />
          <Button type="submit" loading={act.busy || running} disabled={running}>
            {running ? 'Working…' : 'Generate summary'}
          </Button>
        </form>
        {job && (
          <p role="status" className="text-sm text-navy-700">
            {job.status === 'queued' && 'Waiting for a worker…'}
            {job.status === 'processing' && (STAGE[job.stage ?? ''] ?? 'Working…')}
            {job.status === 'succeeded' && 'Done — open it from the list.'}
            {job.status === 'failed' && (
              <span className="text-red-700">Failed: {job.error?.message ?? 'unknown error'}</span>
            )}
            {job.status === 'cancelled' && 'Cancelled.'}
          </p>
        )}
      </Card>
      <div className="lg:col-span-3">
        <h2 className="mb-3 font-semibold text-navy-900">Your summaries</h2>
        <AsyncView
          state={past}
          onRetry={past.reload}
          skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
          isEmpty={(p) => p.data.length === 0}
          empty={<EmptyState title="No summaries yet">Generate one to see it here.</EmptyState>}
        >
          {(p) => (
            <ul className="divide-y divide-navy-50 rounded-xl border border-navy-100 bg-white text-sm">
              {p.data.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-medium text-navy-900">
                      {(o.result as { title?: string } | null)?.title ?? label(o.task)}
                    </p>
                    <p className="text-xs text-navy-600">{formatDateTime(o.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={toneOf(o.reviewStatus)}>{o.reviewStatus}</StatusPill>
                    <Button variant="secondary" onClick={() => setOpen(o)}>
                      {o.reviewStatus === 'draft' ? 'Review' : 'View'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AsyncView>
      </div>
      {open && (
        <AiReviewModal
          output={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            past.reload();
          }}
        />
      )}
    </div>
  );
}
