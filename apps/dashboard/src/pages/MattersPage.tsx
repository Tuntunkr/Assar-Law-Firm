import type { MatterDto } from '@assar/api-client';
import { PRACTICE_AREAS } from '@assar/types';
import {
  Button,
  Modal,
  PageHeader,
  SelectField,
  StatusPill,
  Table,
  Td,
  TextAreaField,
  TextField,
  Th,
} from '@assar/ui';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/AsyncView';
import { PagedView } from '../components/Pager';
import { ClientPicker, MemberPicker, useClients } from '../components/Pickers';
import { useAuth } from '../lib/auth';
import { AREA_LABEL, formatDate, toneOf } from '../lib/format';
import { usePeople } from '../lib/people';
import { useAction } from '../lib/useAction';
import { usePaged } from '../lib/usePaged';

export function MattersPage() {
  const { client, can } = useAuth();
  const { name } = usePeople();
  const clients = useClients();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState('');
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const paged = usePaged(
    (cursor) =>
      client.matters({
        q: q || undefined,
        status: status || undefined,
        clientId: clientId || undefined,
        cursor,
        limit: 25,
      }),
    [client, q, status, clientId],
  );
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader
        title="Matters"
        description="Every case and engagement, with who is on it."
        actions={
          can('matter:write') && <Button onClick={() => setCreating(true)}>New matter</Button>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <TextField
          id="q"
          label="Search"
          placeholder="Title or number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          id="status"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          {['open', 'pending', 'closed', 'archived'].map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="fclient"
          label="Client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </div>
      <PagedView
        paged={paged}
        empty={
          <EmptyState title="No matters found">Adjust the filters or create a matter.</EmptyState>
        }
      >
        {(items: MatterDto[]) => (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Title</Th>
                <Th>Client</Th>
                <Th>Area</Th>
                <Th>Lead</Th>
                <Th>Status</Th>
                <Th>Opened</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="hover:bg-navy-50/50">
                  <Td className="whitespace-nowrap font-mono text-xs">{m.matterNumber}</Td>
                  <Td>
                    <Link
                      className="inline-flex min-h-11 items-center font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                      to={`/matters/${m.id}`}
                    >
                      {m.title}
                    </Link>
                    {m.restricted && (
                      <span title="Restricted access" className="ml-2 text-xs text-navy-500">
                        🔒
                      </span>
                    )}
                  </Td>
                  <Td>{clientName(m.clientId)}</Td>
                  <Td>{AREA_LABEL[m.practiceArea] ?? m.practiceArea}</Td>
                  <Td>{m.leadAttorneyName || name(m.leadAttorneyId)}</Td>
                  <Td>
                    <StatusPill tone={toneOf(m.status)}>{m.status}</StatusPill>
                  </Td>
                  <Td>{formatDate(m.openedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PagedView>
      <NewMatterModal
        open={creating}
        onClose={() => (setCreating(false), params.has('new') && setParams({}, { replace: true }))}
        onCreated={(m) => navigate(`/matters/${m.id}`)}
      />
    </>
  );
}

function NewMatterModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (m: MatterDto) => void;
}) {
  const { client } = useAuth();
  const { run, busy, errors } = useAction();
  const [f, setF] = useState({
    clientId: '',
    title: '',
    practiceArea: 'litigation',
    description: '',
    leadAttorneyId: '',
    restricted: false,
  });
  return (
    <Modal open={open} onClose={onClose} title="New matter" wide>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            clientId: f.clientId,
            title: f.title,
            practiceArea: f.practiceArea,
            restricted: f.restricted,
            ...(f.description ? { description: f.description } : {}),
            ...(f.leadAttorneyId ? { leadAttorneyId: f.leadAttorneyId } : {}),
          };
          const m = await run(() => client.createMatter(body), 'Matter created');
          if (m) {
            onClose();
            onCreated(m);
          }
        }}
      >
        <ClientPicker
          id="mclient"
          label="Client"
          value={f.clientId}
          onChange={(v) => setF({ ...f, clientId: v })}
          error={errors.clientId}
          required
        />
        <TextField
          id="mtitle"
          label="Title"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          error={errors.title}
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            id="area"
            label="Practice area"
            value={f.practiceArea}
            onChange={(e) => setF({ ...f, practiceArea: e.target.value })}
          >
            {PRACTICE_AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABEL[a]}
              </option>
            ))}
          </SelectField>
          <MemberPicker
            id="lead"
            label="Lead attorney"
            value={f.leadAttorneyId}
            onChange={(v) => setF({ ...f, leadAttorneyId: v })}
            blank="None"
          />
        </div>
        <TextAreaField
          id="mdesc"
          label="Description"
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          error={errors.description}
        />
        <label className="flex items-center gap-2 text-sm text-navy-800">
          <input
            type="checkbox"
            checked={f.restricted}
            onChange={(e) => setF({ ...f, restricted: e.target.checked })}
          />
          Restrict access to named people only
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create matter
          </Button>
        </div>
      </form>
    </Modal>
  );
}
