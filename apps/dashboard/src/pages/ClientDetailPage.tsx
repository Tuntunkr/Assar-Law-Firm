import { Alert, Button, Card, Modal, PageHeader, StatusPill, Tabs, TextField } from '@assar/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { ClientDocuments } from '../components/ClientDocuments';
import { ClientSummary } from '../components/ClientSummary';
import { Timeline } from '../components/Timeline';
import { useAuth } from '../lib/auth';
import { formatDate, toneOf } from '../lib/format';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { client, can } = useAuth();
  const data = useAsync(async () => {
    const [c, matters, portal] = await Promise.all([
      client.client(id),
      can('matter:read') ? client.matters({ clientId: id, limit: 50 }) : null,
      can('portal:manage') ? client.portalAccess(id).catch(() => null) : null,
    ]);
    return { c, matters, portal };
  }, [client, id]);
  const act = useAction();
  const [tab, setTab] = useState<'overview' | 'documents' | 'history' | 'summary'>('overview');
  const tabs: { id: 'overview' | 'documents' | 'history' | 'summary'; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(can('matter:read') ? [{ id: 'history' as const, label: 'Case history' }] : []),
    ...(can('document:read') ? [{ id: 'documents' as const, label: 'Documents' }] : []),
    ...(can('ai:use') && can('matter:read')
      ? [{ id: 'summary' as const, label: 'AI summary' }]
      : []),
  ];
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ email: '', name: '' });
  const [token, setToken] = useState<string | null>(null);

  return (
    <AsyncView
      state={data}
      onRetry={data.reload}
      skeleton={<div className="h-40 animate-pulse rounded-xl bg-navy-100" />}
    >
      {({ c, matters, portal }) => (
        <div className="space-y-6">
          <PageHeader
            title={c.name}
            description={
              <span>
                <span className="capitalize">{c.type}</span> · {c.email ?? 'no email'}
              </span>
            }
            actions={
              can('client:write') && (
                <Button
                  variant="secondary"
                  loading={act.busy}
                  onClick={async () => {
                    if (
                      await act.run(
                        () =>
                          client.updateClient(id, {
                            status: c.status === 'active' ? 'archived' : 'active',
                          }),
                        'Client updated',
                      )
                    )
                      data.reload();
                  }}
                >
                  {c.status === 'active' ? 'Archive' : 'Restore'}
                </Button>
              )
            }
          />
          <Tabs label="Client sections" tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'overview' && (
            <>
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <h2 className="mb-3 font-semibold text-navy-900">Details</h2>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-navy-600">Status</dt>
                      <dd>
                        <StatusPill tone={toneOf(c.status)}>{c.status}</StatusPill>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-navy-600">Phone</dt>
                      <dd>{c.phone ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-navy-600">Address</dt>
                      <dd>{c.address ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-navy-600">Added</dt>
                      <dd>{formatDate(c.createdAt)}</dd>
                    </div>
                  </dl>
                </Card>
                <Card className="lg:col-span-2">
                  <h2 className="mb-3 font-semibold text-navy-900">Matters</h2>
                  {!matters || matters.data.length === 0 ? (
                    <EmptyState title="No matters yet" />
                  ) : (
                    <ul className="divide-y divide-navy-50 text-sm">
                      {matters.data.map((m) => (
                        <li key={m.id} className="flex items-center justify-between py-2.5">
                          <Link
                            to={`/matters/${m.id}`}
                            className="inline-flex min-h-11 items-center font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                          >
                            {m.matterNumber} — {m.title}
                          </Link>
                          <StatusPill tone={toneOf(m.status)}>{m.status}</StatusPill>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
              {portal && (
                <Card>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-semibold text-navy-900">Client portal access</h2>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setInviting(true);
                        setToken(null);
                      }}
                    >
                      Invite to portal
                    </Button>
                  </div>
                  {portal.users.length === 0 && portal.invitations.length === 0 ? (
                    <p className="text-sm text-navy-600">This client has no portal users yet.</p>
                  ) : (
                    <ul className="divide-y divide-navy-50 text-sm">
                      {portal.users.map((u) => (
                        <li key={u.id} className="flex items-center justify-between py-2.5">
                          <span>
                            {u.name} <span className="text-navy-600">· {u.email}</span>
                          </span>
                          <span className="flex items-center gap-3">
                            <StatusPill tone={toneOf(u.status)}>{u.status}</StatusPill>
                            <button
                              className="text-xs inline-flex min-h-11 items-center font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                              onClick={async () => {
                                if (
                                  await act.run(
                                    () =>
                                      client.setPortalUserStatus(
                                        id,
                                        u.id,
                                        u.status === 'active' ? 'disabled' : 'active',
                                      ),
                                    'Portal user updated',
                                  )
                                )
                                  data.reload();
                              }}
                            >
                              {u.status === 'active' ? 'Disable' : 'Enable'}
                            </button>
                          </span>
                        </li>
                      ))}
                      {portal.invitations.map((i) => (
                        <li key={i.id} className="flex items-center justify-between py-2.5">
                          <span>
                            {i.email}{' '}
                            <span className="text-navy-600">
                              · invited, expires {formatDate(i.expiresAt)}
                            </span>
                          </span>
                          <StatusPill tone="amber">pending</StatusPill>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Modal
                    open={inviting}
                    onClose={() => setInviting(false)}
                    title="Invite to client portal"
                  >
                    {token ? (
                      <div className="space-y-3">
                        <Alert tone="success">
                          Invitation created. Share this single-use link or token with the client —
                          it is shown once.
                        </Alert>
                        <p className="break-all rounded bg-navy-50 px-3 py-2 font-mono text-xs">
                          {token}
                        </p>
                        <div className="flex justify-end">
                          <Button
                            onClick={() => {
                              setInviting(false);
                              data.reload();
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
                          const r = await act.run(() =>
                            client.invitePortalUser(id, {
                              email: invite.email,
                              ...(invite.name ? { name: invite.name } : {}),
                            }),
                          );
                          if (r) setToken(r.token ?? '(token unavailable)');
                        }}
                      >
                        <TextField
                          id="pemail"
                          label="Client email"
                          type="email"
                          value={invite.email}
                          onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                          error={act.errors.email}
                          required
                        />
                        <TextField
                          id="pname"
                          label="Name (optional)"
                          value={invite.name}
                          onChange={(e) => setInvite({ ...invite, name: e.target.value })}
                          error={act.errors.name}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setInviting(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" loading={act.busy}>
                            Create invitation
                          </Button>
                        </div>
                      </form>
                    )}
                  </Modal>
                </Card>
              )}
            </>
          )}
          {tab === 'documents' && <ClientDocuments clientId={id} />}
          {tab === 'summary' && <ClientSummary clientId={id} />}
          {tab === 'history' && <Timeline scope="client" id={id} />}
        </div>
      )}
    </AsyncView>
  );
}
