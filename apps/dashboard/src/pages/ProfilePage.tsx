import { Alert, Button, Card, PageHeader, StatusPill, Tabs, TextField } from '@assar/ui';
import { PERMISSIONS } from '@assar/types';
import { useState } from 'react';
import { AsyncView } from '../components/AsyncView';
import { SecurityPanel } from '../components/SecurityPanel';
import { useAuth, useMe } from '../lib/auth';
import { formatDateTime, label } from '../lib/format';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

type Tab = 'profile' | 'security' | 'sessions';

const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** A readable device label from a User-Agent string (never trusted for anything but display). */
function device(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

export function ProfilePage() {
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <>
      <PageHeader title="My profile" description="Your details, security and signed-in devices." />
      <Tabs
        label="Profile sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'profile', label: 'Profile' },
          { id: 'security', label: 'Security' },
          { id: 'sessions', label: 'Sessions' },
        ]}
      />
      {tab === 'profile' && <Details />}
      {tab === 'security' && <SecurityPanel />}
      {tab === 'sessions' && <Sessions />}
    </>
  );
}

function Details() {
  const { client, refresh } = useAuth();
  const me = useMe();
  const act = useAction();
  const [name, setName] = useState(me.user.name);
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <div className="flex flex-col items-center text-center">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-indigo-600 text-2xl font-semibold text-white">
            {initials(me.user.name)}
          </span>
          <p className="mt-3 text-lg font-semibold text-navy-900">{me.user.name}</p>
          <p className="text-sm text-navy-600">{me.user.email}</p>
          <div className="mt-3 flex gap-2">
            <StatusPill tone="blue">{me.role}</StatusPill>
            <StatusPill tone={me.mfa.enabled ? 'green' : 'amber'}>
              {me.mfa.enabled ? 'MFA on' : 'MFA off'}
            </StatusPill>
          </div>
          <dl className="mt-5 w-full space-y-2 text-left text-sm">
            <div className="flex justify-between">
              <dt className="text-navy-600">Firm</dt>
              <dd className="text-right font-medium">{me.organization.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-navy-600">Last sign-in</dt>
              <dd>{formatDateTime(me.user.lastLoginAt)}</dd>
            </div>
          </dl>
        </div>
      </Card>
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <h2 className="mb-3 font-semibold text-navy-900">Personal details</h2>
          <form
            className="max-w-sm space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act.run(() => client.updateProfile(name), 'Profile updated'))
                await refresh();
            }}
          >
            <TextField
              id="pname"
              label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={act.errors.name}
              required
            />
            <TextField
              id="pemail"
              label="Email"
              value={me.user.email}
              disabled
              hint="Your sign-in email cannot be changed here."
              readOnly
            />
            <Button type="submit" loading={act.busy} disabled={name.trim() === me.user.name}>
              Save changes
            </Button>
          </form>
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold text-navy-900">What your role can do</h2>
          <p className="mb-3 text-xs text-navy-600">
            Set by your firm's administrators. Access to restricted matters is granted per matter.
          </p>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {PERMISSIONS.map((p) => (
              <li
                key={p}
                className={
                  me.permissions.includes(p) ? 'text-navy-900' : 'text-navy-400 line-through'
                }
              >
                {me.permissions.includes(p) ? '✓' : '·'} {label(p.replace(':', ' · '))}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Sessions() {
  const { client } = useAuth();
  const act = useAction();
  const state = useAsync(() => client.sessions(), [client]);
  return (
    <div className="max-w-3xl space-y-4">
      <Alert tone="info">
        These are the devices currently signed in to your account. Sign out any you do not
        recognise, then change your password.
      </Alert>
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
      >
        {(p) => (
          <>
            <Card className="p-0">
              <ul className="divide-y divide-navy-50">
                {p.data.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm"
                  >
                    <div>
                      <p className="font-medium text-navy-900">
                        {device(s.userAgent)}{' '}
                        {s.current && <StatusPill tone="green">this device</StatusPill>}
                      </p>
                      <p className="text-xs text-navy-600">
                        {s.ip ?? 'Unknown IP'} · signed in {formatDateTime(s.createdAt)} · last
                        active {formatDateTime(s.lastSeenAt)}
                      </p>
                    </div>
                    {!s.current && (
                      <Button
                        variant="secondary"
                        disabled={act.busy}
                        onClick={async () => {
                          if (await act.run(() => client.revokeSession(s.id), 'Session signed out'))
                            state.reload();
                        }}
                      >
                        Sign out
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
            {p.data.length > 1 && (
              <Button
                variant="secondary"
                loading={act.busy}
                onClick={async () => {
                  if (
                    await act.run(
                      () => client.revokeOtherSessions(),
                      'Signed out of all other devices',
                    )
                  )
                    state.reload();
                }}
              >
                Sign out all other devices
              </Button>
            )}
          </>
        )}
      </AsyncView>
    </div>
  );
}
