import type { CourtDto, CourtImportDto, MatterDto } from '@assar/api-client';
import { Button, Card, Modal, SelectField, TextField } from '@assar/ui';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime } from '../lib/format';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

const FIELDS = [
  { key: 'name', label: 'Court' },
  { key: 'caseNumber', label: 'Case number' },
  { key: 'judge', label: 'Judge' },
  { key: 'courtroom', label: 'Courtroom' },
  { key: 'jurisdiction', label: 'Jurisdiction' },
  { key: 'filedOn', label: 'Filed on', type: 'date' },
  { key: 'cnr', label: 'CNR (shape only)' },
  { key: 'officialUrl', label: 'Official https link' },
] as const;
type CourtKey = (typeof FIELDS)[number]['key'];

/** Court details for a matter, plus the next hearing from the calendar. */
export function CourtCard({ matter, onSaved }: { matter: MatterDto; onSaved: () => void }) {
  const { client, can } = useAuth();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const empty: Record<CourtKey, string> = {
    name: '',
    caseNumber: '',
    judge: '',
    courtroom: '',
    jurisdiction: '',
    filedOn: '',
    cnr: '',
    officialUrl: '',
  };
  const [f, setF] = useState<Record<CourtKey, string>>(() => ({
    ...empty,
    ...Object.fromEntries(
      FIELDS.map(({ key }) => [key, String((matter.court as CourtDto | null)?.[key] ?? '')]),
    ),
  }));

  const [importId, setImportId] = useState('');
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
  const canWriteMatter = can('matter:write');
  const imports = useAsync(async () => {
    if (!canWriteMatter) return [] as CourtImportDto[];
    try {
      const feed = await client.courtFeed();
      if (feed.mode !== 'import') return [] as CourtImportDto[];
      const list = await client.courtImports();
      return list.data.filter((row) => row.status === 'stored');
    } catch {
      return [] as CourtImportDto[];
    }
  }, [client, canWriteMatter, matter.id]);

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
                  : String(c[key] ?? '—')}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-navy-600">No court recorded for this matter.</p>
      )}
      {c && (
        <p className="mt-3 text-sm text-navy-700">
          Source:{' '}
          {c.trackingSource === 'import'
            ? 'applied from an authorised file-drop import'
            : 'typed by the firm'}
          . Lookup: not performed.
          {c.freshness === 'verified_manual'
            ? c.stale
              ? ' Last manual check is older than 7 days.'
              : ' A person recorded a manual check.'
            : ' Not yet checked against an official source.'}
          {c.officialUrl ? (
            <>
              {' '}
              <a className="underline" href={c.officialUrl} rel="noreferrer" target="_blank">
                Open the link the firm saved
              </a>
            </>
          ) : null}
        </p>
      )}
      {can('matter:write') && imports.status === 'ready' && imports.data.length > 0 && (
        <div className="mt-3 space-y-2 rounded-lg border border-navy-100 p-3">
          <p className="text-sm text-navy-700">
            Apply a stored file-drop row. This does not call a court.
          </p>
          <SelectField
            id="court-import"
            label="Stored import"
            value={importId}
            onChange={(e) => setImportId(e.target.value)}
          >
            <option value="">Choose a row</option>
            {imports.data.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title} · {row.caseNumber}
                {row.appliedToMatter ? ' (applied before)' : ''}
              </option>
            ))}
          </SelectField>
          <Button
            variant="secondary"
            disabled={!importId || act.busy}
            onClick={() =>
              act
                .run(
                  () =>
                    client.applyCourtImport(importId, {
                      matterId: matter.id,
                      note: 'Applied from authorised file-drop after review',
                    }),
                  'Import applied to this matter',
                )
                .then((ok) => {
                  if (ok) {
                    setImportId('');
                    imports.reload();
                    onSaved();
                  }
                })
            }
          >
            Apply import to this matter
          </Button>
        </div>
      )}
      {c && can('matter:write') && (
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() =>
            act
              .run(() => client.verifyCourt(matter.id), 'Manual check recorded')
              .then((ok) => {
                if (ok) onSaved();
              })
          }
        >
          I compared this with the official record
        </Button>
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
            {FIELDS.map((field) => (
              <TextField
                key={field.key}
                id={`court-${field.key}`}
                label={field.label}
                type={'type' in field ? field.type : undefined}
                value={f[field.key]}
                onChange={(e) => setF({ ...f, [field.key]: e.target.value })}
                error={act.errors[`court.${field.key}`]}
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
