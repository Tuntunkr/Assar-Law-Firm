import type { CourtDto, MatterDto } from '@assar/api-client';
import { Button, Card, Modal, TextField } from '@assar/ui';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime } from '../lib/format';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

const FIELDS: { key: keyof CourtDto; label: string; type?: string }[] = [
  { key: 'name', label: 'Court' },
  { key: 'caseNumber', label: 'Case number' },
  { key: 'judge', label: 'Judge' },
  { key: 'courtroom', label: 'Courtroom' },
  { key: 'jurisdiction', label: 'Jurisdiction' },
  { key: 'filedOn', label: 'Filed on', type: 'date' },
];

/** Court details for a matter, plus the next hearing from the calendar. */
export function CourtCard({ matter, onSaved }: { matter: MatterDto; onSaved: () => void }) {
  const { client, can } = useAuth();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const empty: Record<keyof CourtDto, string> = {
    name: '',
    caseNumber: '',
    judge: '',
    courtroom: '',
    jurisdiction: '',
    filedOn: '',
  };
  const [f, setF] = useState<Record<keyof CourtDto, string>>(() => ({
    ...empty,
    ...Object.fromEntries(Object.entries(matter.court ?? {}).map(([k, v]) => [k, v ?? ''])),
  }));

  const next = useAsync(async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 365 * 86_400_000);
    const p = await client.events({
      from: from.toISOString(),
      to: to.toISOString(),
      matterId: matter.id,
      kind: 'hearing',
      limit: 20,
    });
    return (
      p.data
        .filter((e) => e.status === 'scheduled')
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null
    );
  }, [client, matter.id]);

  const c = matter.court;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-navy-900">Court</h2>
        {can('matter:write') && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            {c ? 'Edit' : 'Add court details'}
          </Button>
        )}
      </div>
      {c ? (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {FIELDS.map(({ key, label }) => (
            <div key={key}>
              <dt className="text-navy-600">{label}</dt>
              <dd className="font-medium text-navy-900">
                {key === 'filedOn'
                  ? c.filedOn
                    ? formatDate(`${c.filedOn}T00:00:00`)
                    : '—'
                  : (c[key] ?? '—')}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-navy-600">No court recorded for this matter.</p>
      )}
      <div className="mt-4 rounded-lg bg-navy-50 px-3 py-2 text-sm">
        <span className="text-navy-600">Next hearing: </span>
        <span className="font-medium text-navy-900">
          {next.status === 'ready'
            ? next.data
              ? `${next.data.title} · ${formatDateTime(next.data.startsAt)}`
              : 'None scheduled'
            : '…'}
        </span>
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title="Court details" wide>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const filled = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ''));
            const body = Object.keys(filled).length ? filled : null;
            if (
              await act.run(
                () => client.updateMatter(matter.id, { court: body }),
                'Court details saved',
              )
            ) {
              setEditing(false);
              onSaved();
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(({ key, label, type }) => (
              <TextField
                key={key}
                id={`court-${key}`}
                label={label}
                type={type}
                value={f[key]}
                onChange={(e) => setF({ ...f, [key]: e.target.value })}
                error={act.errors[`court.${key}`]}
              />
            ))}
          </div>
          <p className="text-xs text-navy-600">
            Leave everything blank to remove the court details.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={act.busy}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
