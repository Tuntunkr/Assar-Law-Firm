import type { InvoiceDto } from '@assar/api-client';
import { PAYMENT_METHODS, REMINDER_CHANNELS, type ReminderChannel } from '@assar/types';
import {
  Alert,
  Button,
  Card,
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
import { useNavigate, useParams } from 'react-router-dom';
import { AsyncView } from '../components/AsyncView';
import { useAuth } from '../lib/auth';
import {
  formatDate,
  formatHours,
  formatMoney,
  label,
  parseMoneyToCents,
  toneOf,
} from '../lib/format';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

type Dialog = null | 'line' | 'payment' | 'void';

export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const { client, can } = useAuth();
  const navigate = useNavigate();
  const state = useAsync(() => client.invoice(id), [client, id]);
  const act = useAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [f, setF] = useState({
    type: 'expense',
    description: '',
    amount: '',
    method: 'bank_transfer',
    reference: '',
    reason: '',
  });
  const [amountErr, setAmountErr] = useState<string>();
  const write = can('billing:write');

  return (
    <AsyncView
      state={state}
      onRetry={state.reload}
      skeleton={<div className="h-48 animate-pulse rounded-xl bg-navy-100" />}
    >
      {(inv) => {
        const cur = inv.currency;
        const done = async <T,>(fn: () => Promise<T>, msg: string) => {
          if (await act.run(fn, msg)) {
            setDialog(null);
            state.reload();
          }
        };
        const money = (raw: string, min: number) => {
          const c = parseMoneyToCents(raw);
          if (c === null || Math.abs(c) < min) {
            setAmountErr('Enter an amount like 125.50');
            return null;
          }
          setAmountErr(undefined);
          return c;
        };
        return (
          <div className="space-y-6">
            <PageHeader
              title={inv.number ?? 'Draft invoice'}
              description={
                <span>
                  Due {formatDate(inv.dueAt)} ·{' '}
                  <StatusPill tone={toneOf(inv.status)}>{inv.status}</StatusPill>
                </span>
              }
              actions={
                write && (
                  <>
                    {inv.status === 'draft' && (
                      <Button
                        loading={act.busy}
                        onClick={() => done(() => client.issueInvoice(id), 'Invoice issued')}
                      >
                        Issue invoice
                      </Button>
                    )}
                    {inv.status === 'draft' && (
                      <Button variant="secondary" onClick={() => setDialog('line')}>
                        Add line
                      </Button>
                    )}
                    {inv.status === 'draft' && (
                      <Button
                        variant="ghost"
                        disabled={act.busy}
                        onClick={async () => {
                          if (await act.run(() => client.deleteInvoice(id), 'Draft deleted'))
                            navigate('/invoices');
                        }}
                      >
                        Delete draft
                      </Button>
                    )}
                    {inv.status === 'issued' && (
                      <Button onClick={() => setDialog('payment')}>Record payment</Button>
                    )}
                    {(inv.status === 'issued' || inv.status === 'paid') && (
                      <Button variant="secondary" onClick={() => setDialog('void')}>
                        Void
                      </Button>
                    )}
                  </>
                )
              }
            />
            {inv.status === 'void' && <Alert tone="error">Voided: {inv.voidReason}</Alert>}
            <Table>
              <thead>
                <tr>
                  <Th>Description</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Time</Th>
                  <Th className="text-right">Rate</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id}>
                    <Td>{l.description}</Td>
                    <Td className="capitalize">{l.type}</Td>
                    <Td className="text-right tabular-nums">
                      {l.minutes ? formatHours(l.minutes) : '—'}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {l.rateCents != null ? formatMoney(l.rateCents, cur) : '—'}
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(l.amountCents, cur)}</Td>
                    <Td className="text-right">
                      {write && inv.status === 'draft' && (
                        <Button
                          variant="ghost"
                          disabled={act.busy}
                          onClick={() =>
                            done(() => client.removeInvoiceLine(id, l.id), 'Line removed')
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <h2 className="mb-3 font-semibold text-navy-900">Payments</h2>
                {inv.payments.length === 0 ? (
                  <p className="text-sm text-navy-600">No payments recorded.</p>
                ) : (
                  <ul className="divide-y divide-navy-50 text-sm">
                    {inv.payments.map((p) => (
                      <li key={p.id} className="flex justify-between py-2">
                        <span>
                          {formatDate(p.paidAt)} · {label(p.method)}
                          {p.reference ? ` · ${p.reference}` : ''}
                        </span>
                        <span className="tabular-nums">{formatMoney(p.amountCents, cur)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <dl className="space-y-2 text-sm tabular-nums">
                  <div className="flex justify-between">
                    <dt>Subtotal</dt>
                    <dd>{formatMoney(inv.subtotalCents, cur)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Tax ({(inv.taxRateBp / 100).toFixed(2)}%)</dt>
                    <dd>{formatMoney(inv.taxCents, cur)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-navy-100 pt-2 font-semibold">
                    <dt>Total</dt>
                    <dd>{formatMoney(inv.totalCents, cur)}</dd>
                  </div>
                  {inv.status !== 'draft' && (
                    <>
                      <div className="flex justify-between">
                        <dt>Paid</dt>
                        <dd>{formatMoney(inv.amountPaidCents, cur)}</dd>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <dt>Balance due</dt>
                        <dd>{formatMoney(inv.balanceCents, cur)}</dd>
                      </div>
                    </>
                  )}
                </dl>
              </Card>
            </div>
            {inv.status === 'issued' && inv.balanceCents > 0 && inv.dueAt && (
              <PaymentReminder
                invoiceId={id}
                reminders={inv.reminders}
                write={write}
                onLogged={() => state.reload()}
              />
            )}

            <Modal
              open={dialog === 'line'}
              onClose={() => setDialog(null)}
              title="Add invoice line"
            >
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const cents = money(f.amount, 1);
                  if (cents === null) return;
                  done(
                    () =>
                      client.addInvoiceLine(id, {
                        type: f.type,
                        description: f.description,
                        amountCents: f.type === 'expense' ? Math.abs(cents) : cents,
                      }),
                    'Line added',
                  );
                }}
              >
                <SelectField
                  id="ltype"
                  label="Type"
                  value={f.type}
                  onChange={(e) => setF({ ...f, type: e.target.value })}
                >
                  <option value="expense">Expense</option>
                  <option value="adjustment">Adjustment / discount</option>
                </SelectField>
                <TextField
                  id="ldesc"
                  label="Description"
                  value={f.description}
                  onChange={(e) => setF({ ...f, description: e.target.value })}
                  error={act.errors.description}
                  required
                />
                <TextField
                  id="lamt"
                  label="Amount"
                  hint={
                    f.type === 'adjustment'
                      ? 'Use a negative amount for a discount, e.g. -50.00'
                      : undefined
                  }
                  inputMode="decimal"
                  value={f.amount}
                  onChange={(e) => setF({ ...f, amount: e.target.value })}
                  error={amountErr ?? act.errors.amountCents}
                  required
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={act.busy}>
                    Add line
                  </Button>
                </div>
              </form>
            </Modal>
            <Modal
              open={dialog === 'payment'}
              onClose={() => setDialog(null)}
              title="Record payment"
            >
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const cents = money(f.amount, 1);
                  if (cents === null) return;
                  done(
                    () =>
                      client.recordPayment(id, {
                        amountCents: cents,
                        method: f.method,
                        ...(f.reference ? { reference: f.reference } : {}),
                      }),
                    'Payment recorded',
                  );
                }}
              >
                <TextField
                  id="pamt"
                  label={`Amount (balance ${formatMoney(inv.balanceCents, cur)})`}
                  inputMode="decimal"
                  value={f.amount}
                  onChange={(e) => setF({ ...f, amount: e.target.value })}
                  error={amountErr ?? act.errors.amountCents}
                  required
                />
                <SelectField
                  id="pmethod"
                  label="Method"
                  value={f.method}
                  onChange={(e) => setF({ ...f, method: e.target.value })}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {label(m)}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  id="pref"
                  label="Reference"
                  value={f.reference}
                  onChange={(e) => setF({ ...f, reference: e.target.value })}
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={act.busy}>
                    Record payment
                  </Button>
                </div>
              </form>
            </Modal>
            <Modal open={dialog === 'void'} onClose={() => setDialog(null)} title="Void invoice">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  done(() => client.voidInvoice(id, f.reason), 'Invoice voided');
                }}
              >
                <p className="text-sm text-navy-700">
                  Voiding releases the billed time so it can be invoiced again. This cannot be
                  undone.
                </p>
                <TextField
                  id="vreason"
                  label="Reason"
                  value={f.reason}
                  onChange={(e) => setF({ ...f, reason: e.target.value })}
                  error={act.errors.reason}
                  required
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={act.busy}>
                    Void invoice
                  </Button>
                </div>
              </form>
            </Modal>
          </div>
        );
      }}
    </AsyncView>
  );
}

function PaymentReminder({
  invoiceId,
  reminders,
  write,
  onLogged,
}: {
  invoiceId: string;
  reminders: InvoiceDto['reminders'];
  write: boolean;
  onLogged: () => void;
}) {
  const { client } = useAuth();
  const draft = useAsync(() => client.invoiceReminderDraft(invoiceId), [client, invoiceId]);
  const act = useAction();
  const [channel, setChannel] = useState<ReminderChannel>('phone');
  const [note, setNote] = useState('');

  return (
    <Card>
      <h2 className="mb-1 font-semibold text-navy-900">Payment reminder</h2>
      <p className="mb-4 text-sm text-navy-600">
        Email and WhatsApp are not connected. Copy this message, send it yourself, then record how
        you sent it.
      </p>
      <AsyncView
        state={draft}
        onRetry={draft.reload}
        skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
      >
        {(row) => (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!write) return;
              const saved = await act.run(
                () =>
                  client.logInvoiceReminder(invoiceId, {
                    channel,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  }),
                'Reminder recorded',
              );
              if (saved) {
                setNote('');
                onLogged();
              }
            }}
          >
            <TextAreaField
              id="reminder-text"
              label="Message to send"
              value={row.text}
              readOnly
            />
            {write && (
              <>
                <SelectField
                  id="reminder-channel"
                  label="How you sent it"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as ReminderChannel)}
                >
                  {REMINDER_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {label(c)}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  id="reminder-note"
                  label="Note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  hint="Optional. A short record of the conversation."
                />
                <div className="flex justify-end">
                  <Button type="submit" loading={act.busy}>
                    Record reminder
                  </Button>
                </div>
              </>
            )}
          </form>
        )}
      </AsyncView>
      {reminders.length > 0 && (
        <ul className="mt-4 divide-y divide-navy-50 text-sm">
          {reminders.map((r) => (
            <li key={r.id} className="py-2">
              <span className="font-medium text-navy-900">{label(r.channel)}</span>
              <span className="text-navy-600"> · {formatDate(r.at)}</span>
              {r.note ? <p className="text-navy-700">{r.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
