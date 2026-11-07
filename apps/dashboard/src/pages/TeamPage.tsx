import type { MemberDto } from '@assar/api-client';
import {
  Alert,
  Button,
  Card,
  Modal,
  PageHeader,
  SelectField,
  StatusPill,
  Table,
  Tabs,
  Td,
  TextField,
  Th,
} from '@assar/ui';
import { useState } from 'react';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { useAuth, useMe } from '../lib/auth';
import { formatDateTime, formatDate, toneOf } from '../lib/format';
import { usePeople } from '../lib/people';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

const ROLES = ['admin', 'attorney', 'paralegal', 'billing', 'staff'];

export function TeamPage() {
  const [tab, setTab] = useState<'members' | 'invites' | 'teams'>('members');
  return (
    <>
      <PageHeader title="Team" description="Who works at your firm and what they can do." />
      <Tabs
        label="Team sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'members', label: 'Members' },
          { id: 'invites', label: 'Invitations' },
          { id: 'teams', label: 'Teams' },
        ]}
      />
      {tab === 'members' && <Members />}
      {tab === 'invites' && <Invites />}
      {tab === 'teams' && <Teams />}
    </>
  );
}

function Members() {
  const { client } = useAuth();
  const me = useMe();
  const act = useAction();
  const state = useAsync(() => client.members({ limit: 100 }), [client]);
  const update = async (m: MemberDto, b: { role?: string; status?: string }) => {
    if (await act.run(() => client.updateMember(m.userId, b), 'Member updated')) state.reload();
  };
  return (
    <AsyncView
      state={state}
      onRetry={state.reload}
      skeleton={<div className="h-32 animate-pulse rounded-xl bg-navy-100" />}
    >
      {(p) => (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>MFA</Th>
              <Th>Last sign-in</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {p.data.map((m) => {
              const locked = m.userId === me.user.id || m.role === 'owner';
              return (
                <tr key={m.userId}>
                  <Td>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-navy-600">{m.email}</p>
                  </Td>
                  <Td>
                    {locked ? (
                      <span className="capitalize">{m.role}</span>
                    ) : (
                      <select
                        aria-label={`Role of ${m.name}`}
                        className="rounded-md border border-navy-200 bg-white px-2 py-1 text-sm capitalize"
                        value={m.role}
                        disabled={act.busy}
                        onChange={(e) => update(m, { role: e.target.value })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )}
                  </Td>
                  <Td>
                    {m.mfaEnabled ? (
                      <StatusPill tone="green">on</StatusPill>
                    ) : (
                      <StatusPill tone="gray">off</StatusPill>
                    )}
                  </Td>
                  <Td>{formatDateTime(m.lastLoginAt)}</Td>
                  <Td>
                    <StatusPill tone={toneOf(m.status)}>{m.status}</StatusPill>
                  </Td>
                  <Td className="text-right">
                    {!locked && (
                      <Button
                        variant="ghost"
                        disabled={act.busy}
                        onClick={() =>
                          update(m, { status: m.status === 'active' ? 'disabled' : 'active' })
                        }
                      >
                        {m.status === 'active' ? 'Disable' : 'Enable'}
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </AsyncView>
  );
}

function Invites() {
  const { client } = useAuth();
  const act = useAction();
  const state = useAsync(() => client.invitations(), [client]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: '', role: 'attorney' });
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setOpen(true);
            setToken(null);
          }}
        >
          Invite member
        </Button>
      </div>
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
        isEmpty={(p) => p.data.length === 0}
        empty={<EmptyState title="No pending invitations" />}
      >
        {(p) => (
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Expires</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {p.data.map((i) => (
                <tr key={i.id}>
                  <Td>{i.email}</Td>
                  <Td className="capitalize">{i.role}</Td>
                  <Td>{formatDate(i.expiresAt)}</Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      disabled={act.busy}
                      onClick={async () => {
                        if (
                          await act.run(() => client.revokeInvitation(i.id), 'Invitation revoked')
                        )
                          state.reload();
                      }}
                    >
                      Revoke
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </AsyncView>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite a team member">
        {token ? (
          <div className="space-y-3">
            <Alert tone="success">
              Invitation created. Email delivery is not set up yet — share this single-use token
              with the person. It is shown once.
            </Alert>
            <p className="break-all rounded bg-navy-50 px-3 py-2 font-mono text-xs">{token}</p>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setOpen(false);
                  state.reload();
                }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await act.run(() => client.invite(f));
              if (r) setToken(r.token ?? '');
            }}
          >
            <TextField
              id="iemail"
              label="Email"
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              error={act.errors.email}
              required
            />
            <SelectField
              id="irole"
              label="Role"
              value={f.role}
              onChange={(e) => setF({ ...f, role: e.target.value })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={act.busy}>
                Send invitation
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function Teams() {
  const { client } = useAuth();
  const { members, name } = usePeople();
  const act = useAction();
  const state = useAsync(() => client.teams({ limit: 100 }), [client]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', description: '', userIds: [] as string[] });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New team</Button>
      </div>
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
        isEmpty={(p) => p.data.length === 0}
        empty={
          <EmptyState title="No teams yet">
            Teams group people for assignment and filtering.
          </EmptyState>
        }
      >
        {(p) => (
          <div className="grid gap-4 sm:grid-cols-2">
            {p.data.map((t) => (
              <Card key={t.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-navy-900">{t.name}</h3>
                    {t.description && <p className="text-sm text-navy-600">{t.description}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    disabled={act.busy}
                    onClick={async () => {
                      if (await act.run(() => client.deleteTeam(t.id), 'Team deleted'))
                        state.reload();
                    }}
                  >
                    Delete
                  </Button>
                </div>
                <p className="mt-3 text-sm text-navy-700">
                  {t.userIds.length ? t.userIds.map(name).join(', ') : 'No members'}
                </p>
              </Card>
            ))}
          </div>
        )}
      </AsyncView>
      <Modal open={open} onClose={() => setOpen(false)} title="New team">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await act.run(
                () =>
                  client.createTeam({
                    name: f.name,
                    userIds: f.userIds,
                    ...(f.description ? { description: f.description } : {}),
                  }),
                'Team created',
              )
            ) {
              setOpen(false);
              setF({ name: '', description: '', userIds: [] });
              state.reload();
            }
          }}
        >
          <TextField
            id="tname"
            label="Name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            error={act.errors.name}
            required
          />
          <TextField
            id="tdesc"
            label="Description"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Members</legend>
            {members
              .filter((m) => m.status === 'active')
              .map((m) => (
                <label key={m.userId} className="flex items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={f.userIds.includes(m.userId)}
                    onChange={(e) =>
                      setF({
                        ...f,
                        userIds: e.target.checked
                          ? [...f.userIds, m.userId]
                          : f.userIds.filter((x) => x !== m.userId),
                      })
                    }
                  />
                  {m.name}
                </label>
              ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={act.busy}>
              Create team
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
