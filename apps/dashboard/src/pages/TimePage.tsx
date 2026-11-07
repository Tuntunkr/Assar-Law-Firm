import type { TimeEntryDto } from '@assar/api-client';
import {
  Button,
  Modal,
  PageHeader,
  SelectField,
  Stat,
  StatusPill,
  Table,
  Td,
  TextAreaField,
  TextField,
  Th,
} from '@assar/ui';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/AsyncView';
import { PagedView } from '../components/Pager';
import { MatterPicker, useMatters } from '../components/Pickers';
import { useAuth } from '../lib/auth';
import { formatDate, formatHours, formatMoney, parseDuration, toneOf, today } from '../lib/format';
import { usePeople } from '../lib/people';
import { useAction } from '../lib/useAction';
import { usePaged } from '../lib/usePaged';

export function TimePage() {
  const { client, can } = useAuth();
  const { name } = usePeople();
  const matters = useMatters();
  const act = useAction();
  const [status, setStatus] = useState('');
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const paged = usePaged(
    (cursor) => client.timeEntries({ status: status || undefined, cursor, limit: 50 }),
    [client, status],
  );
  const matterLabel = (id: string) => matters.find((m) => m.id === id)?.matterNumber ?? '—';
  const totalMinutes = paged.items.reduce((s, t) => s + t.minutes, 0);
  const unbilled = paged.items
    .filter((t) => t.status === 'unbilled' && t.billable)
    .reduce((s, t) => s + t.amountCents, 0);

  return (
    <>
      <PageHeader
        title="Time"
        description="Record and review billable time."
        actions={<Button onClick={() => setCreating(true)}>Log time</Button>}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Hours shown" value={formatHours(totalMinutes)} />
        <Stat label="Unbilled (shown)" value={formatMoney(unbilled)} />
        <div className="rounded-xl border border-navy-100 bg-white p-5 shadow-sm">
          <SelectField
            id="tfilter"
            label="Filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All entries</option>
            <option value="unbilled">Unbilled</option>
            <option value="invoiced">Invoiced</option>
          </SelectField>
        </div>
      </div>
      <PagedView
        paged={paged}
        empty={
          <EmptyState title="No time entries">Log your first entry to start billing.</EmptyState>
        }
      >
        {(items: TimeEntryDto[]) => (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Matter</Th>
                <Th>Who</Th>
                <Th>Description</Th>
                <Th className="text-right">Time</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <Td className="whitespace-nowrap">{formatDate(t.workDate)}</Td>
                  <Td className="font-mono text-xs">{matterLabel(t.matterId)}</Td>
                  <Td>{name(t.userId)}</Td>
                  <Td className="max-w-sm truncate">
                    {t.description}
                    {!t.billable && (
                      <span className="ml-2 text-xs text-navy-500">non-billable</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatHours(t.minutes)}</Td>
                  <Td className="text-right tabular-nums">
                    {t.billable ? formatMoney(t.amountCents, t.currency) : '—'}
                  </Td>
                  <Td>
                    <StatusPill tone={toneOf(t.status === 'invoiced' ? 'paid' : 'pending')}>
                      {t.status}
                    </StatusPill>
                  </Td>
                  <Td className="text-right">
                    {t.status === 'unbilled' && can('time:write') && (
                      <Button
                        variant="ghost"
                        disabled={act.busy}
                        onClick={async () => {
                          if (await act.run(() => client.deleteTimeEntry(t.id), 'Entry deleted'))
                            paged.reload();
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PagedView>
      <LogTimeModal
        open={creating}
        onClose={() => (setCreating(false), params.has('new') && setParams({}, { replace: true }))}
        onCreated={paged.reload}
      />
    </>
  );
}

function LogTimeModal({
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
    matterId: '',
    workDate: today(),
    duration: '',
    description: '',
    billable: true,
  });
  const [durErr, setDurErr] = useState<string>();
  return (
    <Modal open={open} onClose={onClose} title="Log time">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const minutes = parseDuration(f.duration);
          if (!minutes || minutes < 1 || minutes > 1440)
            return setDurErr('Enter a duration like 1.5, 1:30 or 90m');
          setDurErr(undefined);
          if (
            await run(
              () =>
                client.createTimeEntry({
                  matterId: f.matterId,
                  workDate: f.workDate,
                  minutes,
                  description: f.description,
                  billable: f.billable,
                }),
              'Time logged',
            )
          ) {
            onClose();
            setF({ ...f, duration: '', description: '' });
            onCreated();
          }
        }}
      >
        <MatterPicker
          id="tmatter"
          label="Matter"
          value={f.matterId}
          onChange={(v) => setF({ ...f, matterId: v })}
          error={errors.matterId}
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="tdate"
            label="Date"
            type="date"
            value={f.workDate}
            max={today()}
            onChange={(e) => setF({ ...f, workDate: e.target.value })}
            error={errors.workDate}
            required
          />
          <TextField
            id="tdur"
            label="Duration"
            placeholder="1.5, 1:30 or 90m"
            value={f.duration}
            onChange={(e) => setF({ ...f, duration: e.target.value })}
            error={durErr ?? errors.minutes}
            required
          />
        </div>
        <TextAreaField
          id="tdesc"
          label="What did you do?"
          rows={3}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          error={errors.description}
          required
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.billable}
            onChange={(e) => setF({ ...f, billable: e.target.checked })}
          />{' '}
          Billable
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Log time
          </Button>
        </div>
      </form>
    </Modal>
  );
}
