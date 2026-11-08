import type { ClientDto } from '@assar/api-client';
import {
  Button,
  Modal,
  PageHeader,
  SelectField,
  StatusPill,
  Table,
  Td,
  TextField,
  Th,
} from '@assar/ui';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/AsyncView';
import { PagedView } from '../components/Pager';
import { useAuth } from '../lib/auth';
import { formatDate, toneOf } from '../lib/format';
import { useAction } from '../lib/useAction';
import { usePaged } from '../lib/usePaged';

export function ClientsPage() {
  const { client, can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const paged = usePaged(
    (cursor) => client.clients({ q: q || undefined, status, cursor, limit: 25 }),
    [client, q, status],
  );

  return (
    <>
      <PageHeader
        title="Clients"
        description="People and organizations your firm represents."
        actions={
          can('client:write') && <Button onClick={() => setCreating(true)}>New client</Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-full sm:w-72">
          <TextField
            id="q"
            label="Search"
            placeholder="Name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="w-40">
          <SelectField
            id="status"
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </SelectField>
        </div>
      </div>
      <PagedView
        paged={paged}
        empty={
          <EmptyState title="No clients found">Create your first client to get started.</EmptyState>
        }
      >
        {(items: ClientDto[]) => (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
                <Th>Added</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-navy-50/50">
                  <Td>
                    <Link
                      className="inline-flex min-h-11 items-center font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                      to={`/clients/${c.id}`}
                    >
                      {c.name}
                    </Link>
                  </Td>
                  <Td className="capitalize">{c.type}</Td>
                  <Td>{c.email ?? '—'}</Td>
                  <Td>{c.phone ?? '—'}</Td>
                  <Td>
                    <StatusPill tone={toneOf(c.status)}>{c.status}</StatusPill>
                  </Td>
                  <Td>{formatDate(c.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PagedView>
      <NewClientModal
        open={creating}
        onClose={() => (setCreating(false), params.has('new') && setParams({}, { replace: true }))}
        onCreated={(c) => navigate(`/clients/${c.id}`)}
      />
    </>
  );
}

function NewClientModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: ClientDto) => void;
}) {
  const { client } = useAuth();
  const { run, busy, errors } = useAction();
  const [f, setF] = useState({ type: 'individual', name: '', email: '', phone: '', address: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} title="New client">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ''));
          const c = await run(() => client.createClient(body as never), 'Client created');
          if (c) {
            onClose();
            onCreated(c);
          }
        }}
      >
        <SelectField id="type" label="Type" value={f.type} onChange={set('type')}>
          <option value="individual">Individual</option>
          <option value="organization">Organization</option>
        </SelectField>
        <TextField
          id="name"
          label="Name"
          value={f.name}
          onChange={set('name')}
          error={errors.name}
          required
        />
        <TextField
          id="cemail"
          label="Email"
          type="email"
          value={f.email}
          onChange={set('email')}
          error={errors.email}
        />
        <TextField
          id="phone"
          label="Phone"
          value={f.phone}
          onChange={set('phone')}
          error={errors.phone}
        />
        <TextField
          id="address"
          label="Address"
          value={f.address}
          onChange={set('address')}
          error={errors.address}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create client
          </Button>
        </div>
      </form>
    </Modal>
  );
}
