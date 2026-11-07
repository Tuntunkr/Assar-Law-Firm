import type { MatterDto } from '@assar/api-client';
import { PARTY_ROLES } from '@assar/types';
import {
  Button,
  Card,
  Modal,
  PageHeader,
  SelectField,
  StatusPill,
  Table,
  Tabs,
  Td,
  TextAreaField,
  TextField,
  Th,
} from '@assar/ui';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { CourtCard } from '../components/CourtCard';
import { Timeline } from '../components/Timeline';
import { DocumentVersionsModal } from '../components/DocumentVersionsModal';
import { UploadModal } from '../components/UploadModal';
import { useAuth } from '../lib/auth';
import { AREA_LABEL, formatDate, formatDateTime, isOverdue, label, toneOf } from '../lib/format';
import { usePeople } from '../lib/people';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

type Tab = 'overview' | 'history' | 'documents' | 'parties' | 'tasks' | 'ai' | 'portal' | 'access';

export function MatterDetailPage() {
  const { id = '' } = useParams();
  const { client, can } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const state = useAsync(() => client.matter(id), [client, id]);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'history', label: 'Timeline' },
    ...(can('document:read') ? [{ id: 'documents' as const, label: 'Documents' }] : []),
    { id: 'parties', label: 'Parties' },
    ...(can('task:write') ? [{ id: 'tasks' as const, label: 'Tasks' }] : []),
    ...(can('ai:use') ? [{ id: 'ai' as const, label: 'AI' }] : []),
    ...(can('portal:manage') ? [{ id: 'portal' as const, label: 'Client portal' }] : []),
    ...(can('matter:write') ? [{ id: 'access' as const, label: 'Access' }] : []),
  ];
  return (
    <AsyncView
      state={state}
      onRetry={state.reload}
      skeleton={<div className="h-40 animate-pulse rounded-xl bg-navy-100" />}
    >
      {(m) => (
        <>
          <PageHeader
            title={m.title}
            description={
              <span>
                <span className="font-mono">{m.matterNumber}</span> ·{' '}
                {AREA_LABEL[m.practiceArea] ?? m.practiceArea}
              </span>
            }
            actions={<StatusPill tone={toneOf(m.status)}>{m.status}</StatusPill>}
          />
          <Tabs label="Matter sections" tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'overview' && <Overview m={m} onSaved={state.reload} />}
          {tab === 'history' && <Timeline scope="matter" id={id} />}
          {tab === 'documents' && <Documents id={id} />}
          {tab === 'parties' && <Parties id={id} />}
          {tab === 'tasks' && <MatterTasks id={id} />}
          {tab === 'ai' && <MatterAi id={id} />}
          {tab === 'portal' && <PortalTab m={m} onSaved={state.reload} />}
          {tab === 'access' && <AccessTab id={id} onSaved={state.reload} />}
        </>
      )}
    </AsyncView>
  );
}

function Overview({ m, onSaved }: { m: MatterDto; onSaved: () => void }) {
  const { client, can } = useAuth();
  const { name } = usePeople();
  const act = useAction();
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <h2 className="mb-2 font-semibold text-navy-900">Description</h2>
          <p className="whitespace-pre-wrap text-sm text-navy-800">
            {m.description ?? 'No description.'}
          </p>
        </Card>
        <CourtCard matter={m} onSaved={onSaved} />
      </div>
      <Card>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-navy-600">Lead attorney</dt>
            <dd>{name(m.leadAttorneyId)}</dd>
          </div>
          <div>
            <dt className="text-navy-600">Opened</dt>
            <dd>{formatDate(m.openedAt)}</dd>
          </div>
          <div>
            <dt className="text-navy-600">Closed</dt>
            <dd>{formatDate(m.closedAt)}</dd>
          </div>
          <div>
            <dt className="text-navy-600">Access</dt>
            <dd>{m.restricted ? 'Restricted' : 'Firm-wide'}</dd>
          </div>
        </dl>
        {can('matter:write') && (
          <div className="mt-4">
            <SelectField
              id="mstatus"
              label="Change status"
              value={m.status}
              disabled={act.busy}
              onChange={async (e) => {
                if (
                  await act.run(
                    () => client.updateMatter(m.id, { status: e.target.value }),
                    'Matter updated',
                  )
                )
                  onSaved();
              }}
            >
              {['open', 'pending', 'closed', 'archived'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
          </div>
        )}
      </Card>
    </div>
  );
}

function Documents({ id }: { id: string }) {
  const { client, can } = useAuth();
  const state = useAsync(() => client.documents(id, { limit: 100 }), [client, id]);
  const [open, setOpen] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <div className="space-y-4">
      {can('document:write') && (
        <div className="flex justify-end">
          <Button onClick={() => setUploading(true)}>Upload document</Button>
        </div>
      )}
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
        isEmpty={(p) => p.data.length === 0}
        empty={
          <EmptyState title="No documents yet">
            Upload the first document for this matter.
          </EmptyState>
        }
      >
        {(p) => (
          <Table>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Latest file</Th>
                <Th>Updated</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {p.data.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium">{d.title}</Td>
                  <Td className="text-xs text-navy-600">
                    {d.latest
                      ? `v${d.latestVersion} · ${d.latest.filename}`
                      : `v${d.latestVersion}`}
                  </Td>
                  <Td>{formatDate(d.updatedAt)}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" onClick={() => setOpen(d.id)}>
                      Open
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </AsyncView>
      <DocumentVersionsModal
        documentId={open}
        onClose={() => setOpen(null)}
        onChanged={state.reload}
      />
      <UploadModal
        open={uploading}
        matterId={id}
        onClose={() => setUploading(false)}
        onUploaded={state.reload}
      />
    </div>
  );
}

function Parties({ id }: { id: string }) {
  const { client, can } = useAuth();
  const act = useAction();
  const state = useAsync(() => client.parties(id), [client, id]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', type: 'individual', role: 'opposing_party', email: '' });
  return (
    <div className="space-y-4">
      {can('matter:write') && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>Add party</Button>
        </div>
      )}
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
        isEmpty={(p) => p.data.length === 0}
        empty={<EmptyState title="No parties recorded" />}
      >
        {(p) => (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Type</Th>
                <Th>Email</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {p.data.map((x) => (
                <tr key={x.id}>
                  <Td className="font-medium">{x.name}</Td>
                  <Td className="capitalize">{label(x.role)}</Td>
                  <Td className="capitalize">{x.type}</Td>
                  <Td>{x.email ?? '—'}</Td>
                  <Td className="text-right">
                    {can('matter:write') && (
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          if (await act.run(() => client.removeParty(id, x.id), 'Party removed'))
                            state.reload();
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </AsyncView>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add party">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await act.run(
                () => client.addParty(id, { ...f, ...(f.email ? {} : { email: undefined }) }),
                'Party added',
              )
            ) {
              setAdding(false);
              setF({ ...f, name: '', email: '' });
              state.reload();
            }
          }}
        >
          <TextField
            id="pname"
            label="Name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            error={act.errors.name}
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="ptype"
              label="Type"
              value={f.type}
              onChange={(e) => setF({ ...f, type: e.target.value })}
            >
              <option value="individual">Individual</option>
              <option value="organization">Organization</option>
            </SelectField>
            <SelectField
              id="prole"
              label="Role"
              value={f.role}
              onChange={(e) => setF({ ...f, role: e.target.value })}
            >
              {PARTY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </SelectField>
          </div>
          <TextField
            id="pemail"
            label="Email"
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            error={act.errors.email}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={act.busy}>
              Add
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function MatterTasks({ id }: { id: string }) {
  const { client } = useAuth();
  const { name } = usePeople();
  const state = useAsync(() => client.tasks({ matterId: id, limit: 100 }), [client, id]);
  return (
    <AsyncView
      state={state}
      onRetry={state.reload}
      skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
      isEmpty={(p) => p.data.length === 0}
      empty={<EmptyState title="No tasks on this matter" />}
    >
      {(p) => (
        <Table>
          <thead>
            <tr>
              <Th>Task</Th>
              <Th>Assignee</Th>
              <Th>Due</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {p.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.title}</Td>
                <Td>{name(t.assigneeId)}</Td>
                <Td className={isOverdue(t.dueAt, t.status) ? 'font-medium text-red-700' : ''}>
                  {formatDate(t.dueAt)}
                </Td>
                <Td>
                  <StatusPill tone={toneOf(t.status)}>{label(t.status)}</StatusPill>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AsyncView>
  );
}

const AI_TASK_OPTIONS = [
  'summary',
  'document_qa',
  'extraction',
  'chronology',
  'clause_review',
  'drafting',
  'missing_info',
];

function MatterAi({ id }: { id: string }) {
  const { client } = useAuth();
  const act = useAction();
  const docs = useAsync(() => client.documents(id, { limit: 100 }), [client, id]);
  const jobs = useAsync(() => client.aiJobs({ matterId: id, limit: 20 }), [client, id]);
  const [task, setTask] = useState('summary');
  const [selected, setSelected] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="mb-1 font-semibold text-navy-900">Run an AI task</h2>
        <p className="mb-3 text-xs text-navy-600">
          Results are drafts that an attorney must review and approve before use.
        </p>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act.run(
              () =>
                client.createAiJob({
                  task,
                  matterId: id,
                  documents: selected.map((documentId) => ({ documentId })),
                  ...(instructions ? { instructions } : {}),
                }),
              'Job queued',
            );
            if (r) {
              setSelected([]);
              setInstructions('');
              jobs.reload();
            }
          }}
        >
          <SelectField
            id="aitask"
            label="Task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
          >
            {AI_TASK_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </SelectField>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-navy-900">Source documents</legend>
            {docs.status === 'ready' && docs.data.data.length === 0 && (
              <p className="text-sm text-navy-600">Upload a document to this matter first.</p>
            )}
            {docs.status === 'ready' &&
              docs.data.data.map((d) => (
                <label key={d.id} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(d.id)}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id),
                      )
                    }
                  />
                  {d.title}
                </label>
              ))}
            {act.errors.documents && (
              <p role="alert" className="text-xs font-medium text-red-700">
                {act.errors.documents}
              </p>
            )}
          </fieldset>
          <TextAreaField
            id="aiinst"
            label={
              task === 'document_qa'
                ? 'Question'
                : task === 'drafting'
                  ? 'Drafting brief'
                  : 'Instructions (optional)'
            }
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            error={act.errors.instructions}
            rows={3}
          />
          <Button type="submit" loading={act.busy} disabled={selected.length === 0}>
            Run task
          </Button>
        </form>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold text-navy-900">Recent jobs</h2>
        <AsyncView
          state={jobs}
          onRetry={jobs.reload}
          skeleton={<div className="h-24 animate-pulse rounded bg-navy-100" />}
          isEmpty={(p) => p.data.length === 0}
          empty={<EmptyState title="No jobs yet" />}
        >
          {(p) => (
            <ul className="divide-y divide-navy-50 text-sm">
              {p.data.map((j) => (
                <li key={j.id} className="flex items-center justify-between py-2.5">
                  <span className="capitalize">{label(j.task)}</span>
                  <span className="flex items-center gap-2 text-xs text-navy-600">
                    {formatDateTime(j.createdAt)}{' '}
                    <StatusPill tone={toneOf(j.status)}>{j.status}</StatusPill>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AsyncView>
        <Button variant="ghost" className="mt-2" onClick={jobs.reload}>
          Refresh
        </Button>
      </Card>
    </div>
  );
}

function PortalTab({ m, onSaved }: { m: MatterDto; onSaved: () => void }) {
  const { client } = useAuth();
  const act = useAction();
  const [visible, setVisible] = useState(m.portalVisible);
  const [note, setNote] = useState(m.portalNote ?? '');
  return (
    <Card className="max-w-xl">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act.run(
              () => client.setMatterPortal(m.id, { visible, note: note.trim() || null }),
              'Portal settings saved',
            )
          )
            onSaved();
        }}
      >
        <label className="flex items-center gap-2 text-sm text-navy-800">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />{' '}
          Visible to the client in their portal
        </label>
        <TextAreaField
          id="pnote"
          label="Status message for the client"
          hint="Plain language. This is shown to the client."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={act.errors.note}
          rows={3}
        />
        <Button type="submit" loading={act.busy}>
          Save
        </Button>
      </form>
    </Card>
  );
}

function AccessTab({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { client } = useAuth();
  const { members } = usePeople();
  const act = useAction();
  const state = useAsync(() => client.matterAccess(id), [client, id]);
  const [restricted, setRestricted] = useState<boolean | null>(null);
  const [users, setUsers] = useState<string[] | null>(null);
  return (
    <AsyncView
      state={state}
      onRetry={state.reload}
      skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
    >
      {(a) => {
        const r = restricted ?? a.restricted;
        const u = users ?? a.userIds;
        return (
          <Card className="max-w-xl space-y-3">
            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                checked={r}
                onChange={(e) => setRestricted(e.target.checked)}
              />{' '}
              Restrict this matter to selected people
            </label>
            {r && (
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-navy-900">
                  People with access
                </legend>
                {members
                  .filter((x) => x.status === 'active')
                  .map((x) => (
                    <label key={x.userId} className="flex items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={u.includes(x.userId)}
                        onChange={(e) =>
                          setUsers(
                            e.target.checked ? [...u, x.userId] : u.filter((i) => i !== x.userId),
                          )
                        }
                      />
                      {x.name} <span className="text-xs capitalize text-navy-500">{x.role}</span>
                    </label>
                  ))}
              </fieldset>
            )}
            <Button
              loading={act.busy}
              onClick={async () => {
                if (
                  await act.run(
                    () => client.setMatterAccess(id, { restricted: r, userIds: u }),
                    'Access updated',
                  )
                ) {
                  onSaved();
                  state.reload();
                }
              }}
            >
              Save access
            </Button>
          </Card>
        );
      }}
    </AsyncView>
  );
}
