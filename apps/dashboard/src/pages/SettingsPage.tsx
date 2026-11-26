import { CURRENCIES } from '@assar/types';
import {
  Alert,
  Button,
  Card,
  Modal,
  PageHeader,
  SelectField,
  Table,
  Tabs,
  Td,
  TextField,
  Th,
} from '@assar/ui';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, parseMoneyToCents } from '../lib/format';
import { usePeople } from '../lib/people';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

type Tab = 'firm' | 'billing' | 'automation';

export function SettingsPage() {
  const { can } = useAuth();
  const tabs: { id: Tab; label: string }[] = [
    ...(can('org:manage') ? [{ id: 'firm' as const, label: 'Firm' }] : []),
    ...(can('billing:write') ? [{ id: 'billing' as const, label: 'Billing' }] : []),
    ...(can('workflow:manage') ? [{ id: 'automation' as const, label: 'Automation' }] : []),
  ];
  const [picked, setTab] = useState<Tab | null>(null);
  const tab = picked && tabs.some((t) => t.id === picked) ? picked : (tabs[0]?.id ?? 'firm');
  return (
    <>
      <PageHeader title="Settings" description="Firm-wide configuration." />
      {tabs.length === 0 ? (
        <p className="text-sm text-navy-600">
          Firm settings are managed by your administrators. Your own details and security are on
          your{' '}
          <Link to="/profile" className="inline-flex min-h-11 items-center font-medium text-accent-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500">
            profile
          </Link>
          .
        </p>
      ) : (
        <Tabs label="Settings sections" tabs={tabs} value={tab} onChange={setTab} />
      )}
      {tabs.length > 0 && tab === 'firm' && <Firm />}
      {tab === 'billing' && <BillingSettings />}
      {tab === 'automation' && <Automation />}
    </>
  );
}

function Firm() {
  const { client } = useAuth();
  const act = useAction();
  const state = useAsync(() => client.organization(), [client]);
  const [name, setName] = useState<string | null>(null);
  return (
    <AsyncView
      state={state}
      onRetry={state.reload}
      skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
    >
      {(o) => (
        <Card className="max-w-md space-y-3">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act.run(() => client.renameOrganization(name ?? o.name), 'Firm renamed'))
                state.reload();
            }}
          >
            <TextField
              id="oname"
              label="Firm name"
              value={name ?? o.name}
              onChange={(e) => setName(e.target.value)}
              error={act.errors.name}
              required
            />
            <p className="text-xs text-navy-600">
              Client portal sign-in identifier: <span className="font-mono">{o.slug}</span>
            </p>
            <Button type="submit" loading={act.busy}>
              Save
            </Button>
          </form>
        </Card>
      )}
    </AsyncView>
  );
}

function BillingSettings() {
  const { client } = useAuth();
  const { members } = usePeople();
  const act = useAction();
  const state = useAsync(() => client.billingSettings(), [client]);
  const [f, setF] = useState<{ currency: string; rate: string; tax: string; due: string } | null>(
    null,
  );
  const [err, setErr] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  return (
    <AsyncView
      state={state}
      onRetry={state.reload}
      skeleton={<div className="h-32 animate-pulse rounded-xl bg-navy-100" />}
    >
      {(s) => {
        const v = f ?? {
          currency: s.currency,
          rate: s.defaultHourlyRateCents == null ? '' : (s.defaultHourlyRateCents / 100).toFixed(2),
          tax: (s.defaultTaxRateBp / 100).toString(),
          due: String(s.invoiceDueDays),
        };
        return (
          <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 font-semibold text-navy-900">Defaults</h2>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const e2: Record<string, string> = {};
                  const rate = v.rate.trim() === '' ? null : parseMoneyToCents(v.rate);
                  if (rate === undefined || (v.rate.trim() !== '' && rate === null))
                    e2.rate = 'Enter an amount like 250.00';
                  const tax = Number(v.tax);
                  if (!Number.isFinite(tax) || tax < 0 || tax > 100)
                    e2.tax = 'Enter a percentage from 0 to 100';
                  const due = Number(v.due);
                  if (!Number.isInteger(due) || due < 0 || due > 365)
                    e2.due = 'Enter whole days, 0–365';
                  setErr(e2);
                  if (Object.keys(e2).length) return;
                  if (
                    await act.run(
                      () =>
                        client.saveBillingSettings({
                          currency: v.currency,
                          defaultHourlyRateCents: rate,
                          defaultTaxRateBp: Math.round(tax * 100),
                          invoiceDueDays: due,
                        }),
                      'Billing settings saved',
                    )
                  ) {
                    setF(null);
                    state.reload();
                  }
                }}
              >
                <SelectField
                  id="cur"
                  label="Currency"
                  value={v.currency}
                  onChange={(e) => setF({ ...v, currency: e.target.value })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </SelectField>
                <TextField
                  id="rate"
                  label="Default hourly rate"
                  inputMode="decimal"
                  value={v.rate}
                  onChange={(e) => setF({ ...v, rate: e.target.value })}
                  error={err.rate}
                  hint="Leave blank for no default."
                />
                <TextField
                  id="tax"
                  label="Default tax rate (%)"
                  inputMode="decimal"
                  value={v.tax}
                  onChange={(e) => setF({ ...v, tax: e.target.value })}
                  error={err.tax}
                />
                <TextField
                  id="due"
                  label="Invoice due (days)"
                  inputMode="numeric"
                  value={v.due}
                  onChange={(e) => setF({ ...v, due: e.target.value })}
                  error={err.due}
                />
                <Button type="submit" loading={act.busy}>
                  Save defaults
                </Button>
              </form>
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold text-navy-900">Hourly rates by person</h2>
              <ul className="divide-y divide-navy-50 text-sm">
                {members
                  .filter((m) => m.status === 'active')
                  .map((m) => (
                    <li key={m.userId} className="flex items-center justify-between gap-2 py-2">
                      <span>{m.name}</span>
                      <span className="flex items-center gap-2">
                        <input
                          aria-label={`Hourly rate for ${m.name}`}
                          placeholder="default"
                          inputMode="decimal"
                          className="w-24 rounded-md border border-navy-200 px-2 py-1 text-right"
                          value={rates[m.userId] ?? ''}
                          onChange={(e) => setRates({ ...rates, [m.userId]: e.target.value })}
                        />
                        <Button
                          variant="ghost"
                          disabled={act.busy || rates[m.userId] === undefined}
                          onClick={async () => {
                            const raw = rates[m.userId]!.trim();
                            const cents = raw === '' ? null : parseMoneyToCents(raw);
                            if (raw !== '' && cents === null) return;
                            await act.run(
                              () => client.setMemberRate(m.userId, cents),
                              `Rate saved for ${m.name} (${cents === null ? 'default' : formatMoney(cents, s.currency)})`,
                            );
                          }}
                        >
                          Save
                        </Button>
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          </div>
        );
      }}
    </AsyncView>
  );
}

function Automation() {
  const { client } = useAuth();
  const act = useAction();
  const scopes = useAsync(() => client.serviceScopes(), [client]);
  const tokens = useAsync(() => client.serviceTokens(), [client]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', scopes: [] as string[], days: '90' });
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="max-w-xl text-sm text-navy-600">
          Service tokens let workflow tools like n8n call a limited set of API endpoints. Each token
          only does what its scopes allow.
        </p>
        <Button
          onClick={() => {
            setOpen(true);
            setSecret(null);
          }}
        >
          New token
        </Button>
      </div>
      <AsyncView
        state={tokens}
        onRetry={tokens.reload}
        skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
        isEmpty={(p) => p.data.length === 0}
        empty={<EmptyState title="No service tokens" />}
      >
        {(p) => (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Scopes</Th>
                <Th>Expires</Th>
                <Th>Last used</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {p.data.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.name}</Td>
                  <Td className="text-xs">{t.scopes.join(', ')}</Td>
                  <Td>{formatDate(t.expiresAt)}</Td>
                  <Td>{formatDate(t.lastUsedAt)}</Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      disabled={act.busy}
                      onClick={async () => {
                        if (await act.run(() => client.revokeServiceToken(t.id), 'Token revoked'))
                          tokens.reload();
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
      <Modal open={open} onClose={() => setOpen(false)} title="New service token">
        {secret ? (
          <div className="space-y-3">
            <Alert tone="success">
              Copy this token now. It is shown only once and cannot be retrieved later.
            </Alert>
            <p className="break-all rounded bg-navy-50 px-3 py-2 font-mono text-xs">{secret}</p>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setOpen(false);
                  tokens.reload();
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
                client.createServiceToken({
                  name: f.name,
                  scopes: f.scopes,
                  expiresInDays: Number(f.days) || undefined,
                }),
              );
              if (r) setSecret(r.token ?? '');
            }}
          >
            <TextField
              id="stname"
              label="Name"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              error={act.errors.name}
              required
            />
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Scopes</legend>
              {scopes.status === 'ready' &&
                scopes.data.scopes.map((s) => (
                  <label key={s} className="flex items-center gap-2 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={f.scopes.includes(s)}
                      onChange={(e) =>
                        setF({
                          ...f,
                          scopes: e.target.checked
                            ? [...f.scopes, s]
                            : f.scopes.filter((x) => x !== s),
                        })
                      }
                    />
                    {s}
                  </label>
                ))}
              {act.errors.scopes && (
                <p role="alert" className="text-xs font-medium text-red-700">
                  {act.errors.scopes}
                </p>
              )}
            </fieldset>
            <TextField
              id="stdays"
              label="Expires in (days)"
              inputMode="numeric"
              value={f.days}
              onChange={(e) => setF({ ...f, days: e.target.value })}
              error={act.errors.expiresInDays}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={act.busy}>
                Create token
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
