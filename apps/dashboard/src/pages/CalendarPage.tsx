import type { EventDto } from '@assar/api-client';
import { HEARING_RESULTS } from '@assar/types';
import {
  Button,
  Modal,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
  TextField,
} from '@assar/ui';
import { useEffect, useMemo, useState } from 'react';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { MatterPicker } from '../components/Pickers';
import { useAuth } from '../lib/auth';
import { formatTime, toneOf } from '../lib/format';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

const KINDS = ['hearing', 'deadline', 'meeting', 'reminder', 'other'];
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function CalendarPage() {
  const { client, can } = useAuth();
  const act = useAction();
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [creating, setCreating] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<EventDto | null>(null);
  const range = useMemo(() => {
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [month]);
  const state = useAsync(() => client.events({ ...range, limit: 100 }), [client, range.from]);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Hearings, deadlines and meetings."
        actions={<Button onClick={() => setCreating(true)}>New event</Button>}
      />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="secondary" aria-label="Previous month" onClick={() => shift(-1)}>
          ‹
        </Button>
        <h2 className="min-w-40 text-center font-semibold text-navy-900">
          {month.toLocaleString('en', { month: 'long', year: 'numeric' })}
        </h2>
        <Button variant="secondary" aria-label="Next month" onClick={() => shift(1)}>
          ›
        </Button>
        <Button
          variant="ghost"
          onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
        >
          Today
        </Button>
      </div>
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={<div className="h-64 animate-pulse rounded-xl bg-navy-100" />}
        isEmpty={(p) => p.data.length === 0}
        empty={<EmptyState title="No events this month" />}
      >
        {(p) => {
          const byDay = new Map<string, EventDto[]>();
          for (const e of p.data) {
            const k = dayKey(new Date(e.startsAt));
            byDay.set(k, [...(byDay.get(k) ?? []), e]);
          }
          return (
            <ol className="space-y-3">
              {[...byDay.entries()].sort().map(([day, evs]) => (
                <li key={day} className="rounded-xl border border-navy-100 bg-white shadow-sm">
                  <h3 className="border-b border-navy-50 px-4 py-2 text-sm font-semibold text-navy-900">
                    {new Date(`${day}T00:00:00`).toLocaleDateString('en', {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </h3>
                  <ul className="divide-y divide-navy-50">
                    {evs.map((e) => (
                      <li
                        key={e.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                      >
                        <div>
                          <p
                            className={`font-medium ${e.status === 'cancelled' ? 'line-through text-navy-500' : ''}`}
                          >
                            {e.title}
                          </p>
                          <p className="text-xs text-navy-600">
                            {e.allDay ? 'All day' : formatTime(e.startsAt)}
                            {e.location ? ` · ${e.location}` : ''}
                          </p>
                          {e.kind === 'hearing' && (
                            <p className="text-xs text-navy-700">
                              {e.outcome
                                ? `Outcome ${e.outcome.result}, ${e.outcome.reviewStatus}. Next date is a note, not a filing.`
                                : 'No outcome recorded.'}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusPill tone={toneOf(e.kind)}>{e.kind}</StatusPill>
                          {e.kind === 'hearing' && can('calendar:write') && (
                            <Button
                              variant="ghost"
                              disabled={act.busy}
                              onClick={() => setOutcomeFor(e)}
                            >
                              Record outcome
                            </Button>
                          )}
                          {e.kind === 'hearing' &&
                            can('hearing:review') &&
                            e.outcome?.reviewStatus === 'draft' && (
                              <Button
                                variant="ghost"
                                disabled={act.busy}
                                onClick={async () => {
                                  if (
                                    await act.run(
                                      () => client.reviewOutcome(e.id),
                                      'Outcome reviewed',
                                    )
                                  )
                                    state.reload();
                                }}
                              >
                                Review
                              </Button>
                            )}
                          {e.status === 'scheduled' && (
                            <Button
                              variant="ghost"
                              disabled={act.busy}
                              onClick={async () => {
                                if (
                                  await act.run(
                                    () => client.updateEvent(e.id, { status: 'completed' }),
                                    'Marked complete',
                                  )
                                )
                                  state.reload();
                              }}
                            >
                              Complete
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            disabled={act.busy}
                            onClick={async () => {
                              if (await act.run(() => client.deleteEvent(e.id), 'Event deleted'))
                                state.reload();
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          );
        }}
      </AsyncView>
      <NewEventModal open={creating} onClose={() => setCreating(false)} onCreated={state.reload} />
      <OutcomeModal
        event={outcomeFor}
        onClose={() => setOutcomeFor(null)}
        onSaved={() => {
          setOutcomeFor(null);
          state.reload();
        }}
      />
    </>
  );
}

function OutcomeModal({
  event,
  onClose,
  onSaved,
}: {
  event: EventDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { client } = useAuth();
  const { run, busy, errors } = useAction();
  const [result, setResult] = useState<string>(HEARING_RESULTS[0]);
  const [notes, setNotes] = useState('');
  const [nextHearingOn, setNextHearingOn] = useState('');
  useEffect(() => {
    if (!event) return;
    setResult(event.outcome?.result ?? HEARING_RESULTS[0]);
    setNotes(event.outcome?.notes ?? '');
    setNextHearingOn('');
  }, [event]);

  return (
    <Modal open={!!event} onClose={onClose} title="Record hearing outcome">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!event) return;
          const body = {
            result,
            notes,
            ...(nextHearingOn ? { nextHearingOn } : {}),
          };
          if (await run(() => client.recordOutcome(event.id, body), 'Outcome saved as a draft')) {
            setNotes('');
            setNextHearingOn('');
            setResult(HEARING_RESULTS[0]);
            onSaved();
          }
        }}
      >
        <p className="text-sm text-navy-700">
          {event?.title ?? 'Hearing'}. Typed notes only — not a court filing and not a calculated
          date.
        </p>
        <SelectField
          id="oresult"
          label="Result"
          value={result}
          onChange={(e) => setResult(e.target.value)}
          error={errors.result}
        >
          {HEARING_RESULTS.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, ' ')}
            </option>
          ))}
        </SelectField>
        <TextAreaField
          id="onotes"
          label="Hearing note"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={errors.notes}
          required
        />
        <TextField
          id="onext"
          label="Next hearing on (optional)"
          type="date"
          value={nextHearingOn}
          onChange={(e) => setNextHearingOn(e.target.value)}
          error={errors.nextHearingOn}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save draft
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NewEventModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { client } = useAuth();
  const { run, busy, errors } = useAction();
  const [f, setF] = useState({
    kind: 'meeting',
    title: '',
    date: '',
    start: '09:00',
    end: '',
    allDay: false,
    location: '',
    description: '',
    matterId: '',
  });
  return (
    <Modal open={open} onClose={onClose} title="New event">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const at = (t: string) =>
            new Date(`${f.date}T${f.allDay ? '00:00' : t}:00`).toISOString();
          const body = {
            kind: f.kind,
            title: f.title,
            allDay: f.allDay,
            startsAt: f.date ? at(f.start) : '',
            ...(f.end && !f.allDay ? { endsAt: at(f.end) } : {}),
            ...(f.location ? { location: f.location } : {}),
            ...(f.description ? { description: f.description } : {}),
            ...(f.matterId ? { matterId: f.matterId } : {}),
          };
          if (await run(() => client.createEvent(body), 'Event created')) {
            onClose();
            setF({ ...f, title: '', description: '' });
            onCreated();
          }
        }}
      >
        <TextField
          id="etitle"
          label="Title"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          error={errors.title}
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            id="ekind"
            label="Type"
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </SelectField>
          <TextField
            id="edate"
            label="Date"
            type="date"
            value={f.date}
            onChange={(e) => setF({ ...f, date: e.target.value })}
            error={errors.startsAt}
            required
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.allDay}
            onChange={(e) => setF({ ...f, allDay: e.target.checked })}
          />{' '}
          All day
        </label>
        {!f.allDay && (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id="estart"
              label="Starts"
              type="time"
              value={f.start}
              onChange={(e) => setF({ ...f, start: e.target.value })}
            />
            <TextField
              id="eend"
              label="Ends"
              type="time"
              value={f.end}
              onChange={(e) => setF({ ...f, end: e.target.value })}
              error={errors.endsAt}
            />
          </div>
        )}
        <TextField
          id="eloc"
          label="Location"
          value={f.location}
          onChange={(e) => setF({ ...f, location: e.target.value })}
        />
        <MatterPicker
          id="ematter"
          label="Matter (optional)"
          blank="No matter"
          value={f.matterId}
          onChange={(v) => setF({ ...f, matterId: v })}
        />
        <TextAreaField
          id="edesc"
          label="Notes"
          rows={2}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create event
          </Button>
        </div>
      </form>
    </Modal>
  );
}
