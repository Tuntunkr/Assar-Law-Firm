import { Button, PageHeader, SelectField, TextAreaField, TextField } from '@assar/ui';
import { useState } from 'react';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { MatterPicker } from '../components/Pickers';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

type Row = {
  id: string;
  title: string;
  kind: string;
  dueOn: string;
  status: string;
  basisNote: string;
  timezone: string;
  statutoryCalculation: string;
};

/** Dates a person typed. Nothing on this page calculates a limitation or sends a message. */
export function DeadlinesPage() {
  const { client, can } = useAuth();
  const act = useAction();
  const state = useAsync(() => client.deadlines() as Promise<{ data: Row[] }>, [client]);
  const [matterId, setMatterId] = useState('');
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [basisNote, setBasisNote] = useState('');
  const [kind, setKind] = useState('other_deadline');

  return (
    <>
      <PageHeader
        title="Dates"
        description="A register of dates someone typed, reviewed in Asia/Kolkata. This is not a statutory calculation and it does not contact a court."
      />
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
        isEmpty={(p) => p.data.length === 0 && !can('matter:write')}
        empty={
          <EmptyState title="No dates yet">
            A lawyer adds a date from the brief, then another lawyer approves it.
          </EmptyState>
        }
      >
        {(p) => (
          <div className="space-y-4">
            {p.data.length === 0 && (
              <EmptyState title="No dates yet">
                Add one below. The software will not invent the day.
              </EmptyState>
            )}
            <ul className="divide-y divide-navy-100 overflow-hidden rounded-xl border border-navy-100 bg-white">
              {p.data.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-navy-900">
                      {row.title}{' '}
                      <span className="font-normal text-navy-600">
                        {row.dueOn} · {row.timezone} · {row.status}
                      </span>
                    </p>
                    <p className="mt-1 max-w-2xl text-sm text-navy-700">{row.basisNote}</p>
                    <p className="mt-1 text-xs text-navy-500">
                      {row.kind}. Statutory calculation: {row.statutoryCalculation}.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {can('matter:write') &&
                      (row.status === 'draft' || row.status === 'rejected') && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            act
                              .run(() => client.submitDeadline(row.id), 'Sent for review')
                              .then((ok) => ok && state.reload())
                          }
                        >
                          Submit
                        </Button>
                      )}
                    {can('deadline:approve') && row.status === 'pending_approval' && (
                      <Button
                        onClick={() =>
                          act
                            .run(() => client.approveDeadline(row.id), 'Date approved')
                            .then((ok) => ok && state.reload())
                        }
                      >
                        Approve
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </AsyncView>
      {can('matter:write') && (
        <form
          className="mt-6 max-w-xl space-y-3 rounded-xl border border-navy-100 bg-white p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await act.run(
              () =>
                client.createDeadline({
                  matterId,
                  kind,
                  title,
                  dueOn,
                  basisNote,
                }),
              'Date saved as a draft',
            );
            if (ok) {
              setTitle('');
              setBasisNote('');
              state.reload();
            }
          }}
        >
          <h2 className="text-sm font-semibold text-navy-900">Add a typed date</h2>
          <MatterPicker
            id="deadline-matter"
            label="Matter"
            value={matterId}
            onChange={setMatterId}
          />
          <SelectField
            id="deadline-kind"
            label="Label"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="other_deadline">Other date</option>
            <option value="limitation">Limitation label (not calculated)</option>
          </SelectField>
          <TextField
            id="deadline-title"
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            id="deadline-due"
            label="Date"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
          <TextAreaField
            id="deadline-basis"
            label="Why this date"
            value={basisNote}
            onChange={(e) => setBasisNote(e.target.value)}
            hint="Write where the date came from. Do not paste a model’s guess."
          />
          <Button type="submit" loading={act.busy}>
            Save draft
          </Button>
        </form>
      )}
    </>
  );
}
