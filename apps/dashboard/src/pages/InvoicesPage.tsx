import type { InvoiceSummaryDto } from '@assar/api-client';
import { Button, Modal, PageHeader, SelectField, StatusPill, Table, Td, Th } from '@assar/ui';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/AsyncView';
import { PagedView } from '../components/Pager';
import { ClientPicker, useClients } from '../components/Pickers';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, toneOf } from '../lib/format';
import { useAction } from '../lib/useAction';
import { usePaged } from '../lib/usePaged';

export function InvoicesPage() {
  const { client, can } = useAuth();
  const clients = useClients();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const paged = usePaged(
    (cursor) => client.invoices({ status: status || undefined, cursor, limit: 25 }),
    [client, status],
  );
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? '—';
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Bill unbilled time, issue invoices and record payments."
        actions={
          can('billing:write') && <Button onClick={() => setCreating(true)}>New invoice</Button>
        }
      />
      <div className="mb-4 w-48">
        <SelectField
          id="istatus"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          {['draft', 'issued', 'paid', 'void'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
      </div>
      <PagedView
        paged={paged}
        empty={
          <EmptyState title="No invoices">
            Create an invoice from a client's unbilled time.
          </EmptyState>
        }
      >
        {(items: InvoiceSummaryDto[]) => (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Client</Th>
                <Th>Status</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="hover:bg-navy-50/50">
                  <Td>
                    <Link
                      className="inline-flex min-h-11 items-center font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                      to={`/invoices/${i.id}`}
                    >
                      {i.number ?? 'Draft'}
                    </Link>
                  </Td>
                  <Td>{clientName(i.clientId)}</Td>
                  <Td>
                    <StatusPill tone={toneOf(i.status)}>{i.status}</StatusPill>
                  </Td>
                  <Td>{formatDate(i.issuedAt)}</Td>
                  <Td>{formatDate(i.dueAt)}</Td>
                  <Td className="text-right tabular-nums">
                    {formatMoney(i.totalCents, i.currency)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatMoney(i.balanceCents, i.currency)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PagedView>
      <NewInvoiceModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => navigate(`/invoices/${id}`)}
      />
    </>
  );
}

function NewInvoiceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { client } = useAuth();
  const { run, busy, errors } = useAction();
  const [clientId, setClientId] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="New invoice">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const unbilled = await run(() =>
            client.timeEntries({ status: 'unbilled', billable: true, limit: 100 }),
          );
          if (!unbilled) return;
          const inv = await run(
            () =>
              client.createInvoice({
                clientId,
                ...(unbilled.data.length
                  ? {
                      timeEntryIds: unbilled.data
                        .filter((t) => t.clientId === clientId)
                        .map((t) => t.id),
                    }
                  : {}),
              }),
            'Draft invoice created',
          );
          if (inv) {
            onClose();
            onCreated(inv.id);
          }
        }}
      >
        <p className="text-sm text-navy-700">
          A draft is created from this client's unbilled billable time. You can add expenses or
          adjustments before issuing.
        </p>
        <ClientPicker
          id="iclient"
          label="Client"
          value={clientId}
          onChange={setClientId}
          error={errors.clientId}
          required
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!clientId}>
            Create draft
          </Button>
        </div>
      </form>
    </Modal>
  );
}
