import { Button, PageHeader, SelectField, TextAreaField, TextField } from '@assar/ui';
import { useState } from 'react';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { ClientPicker, MatterPicker } from '../components/Pickers';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

type Row = {
  id: string;
  channel: string;
  templateLabel: string;
  body: string;
  status: string;
  provider: string;
  providerTemplateApproval: string;
};

/** Previews only. Approval does not send mail or WhatsApp unless a provider is actually configured, which it is not in this build. */
export function OutboxPage() {
  const { client, can } = useAuth();
  const act = useAction();
  const state = useAsync(() => client.outbox() as Promise<{ data: Row[] }>, [client]);
  const [clientId, setClientId] = useState('');
  const [matterId, setMatterId] = useState('');
  const [channel, setChannel] = useState('email');
  const [templateLabel, setTemplateLabel] = useState('');
  const [body, setBody] = useState('');
  const [consent, setConsent] = useState(false);

  return (
    <>
      <PageHeader
        title="Client updates"
        description="Draft a preview. A lawyer approves it. Without a provider credential this stays inside Assar. Template approval is not claimed."
      />
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={<div className="h-24 animate-pulse rounded-xl bg-navy-100" />}
        isEmpty={(p) => p.data.length === 0}
        empty={<EmptyState title="No previews">Nothing has been drafted for a client.</EmptyState>}
      >
        {(p) => (
          <ul className="divide-y divide-navy-100 overflow-hidden rounded-xl border border-navy-100 bg-white">
            {p.data.map((row) => (
              <li key={row.id} className="space-y-2 px-4 py-3">
                <p className="font-medium text-navy-900">
                  {row.templateLabel}{' '}
                  <span className="font-normal text-navy-600">
                    {row.channel} · {row.status} · {row.provider}
                  </span>
                </p>
                <p className="whitespace-pre-wrap text-sm text-navy-800">{row.body}</p>
                <p className="text-xs text-navy-500">
                  Provider template: {row.providerTemplateApproval}. This row is not proof a message
                  left the firm.
                </p>
                {can('message:approve') && row.status === 'pending_approval' && (
                  <Button
                    onClick={() =>
                      act
                        .run(() => client.approveOutbox(row.id), 'Decision recorded')
                        .then((ok) => {
                          if (ok) state.reload();
                        })
                    }
                  >
                    Approve preview
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </AsyncView>
      {can('matter:write') && (
        <form
          className="mt-6 max-w-xl space-y-3 rounded-xl border border-navy-100 bg-white p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!consent) return;
            const ok = await act.run(
              () =>
                client.createOutbox({
                  clientId,
                  ...(matterId ? { matterId } : {}),
                  channel,
                  templateLabel,
                  body,
                  consent: { optedIn: true, namesFirm: true },
                }),
              'Preview sent for review',
            );
            if (ok) {
              setBody('');
              state.reload();
            }
          }}
        >
          <h2 className="text-sm font-semibold text-navy-900">New preview</h2>
          <ClientPicker id="outbox-client" label="Client" value={clientId} onChange={setClientId} />
          <MatterPicker id="outbox-matter" label="Matter" value={matterId} onChange={setMatterId} />
          <SelectField
            id="outbox-channel"
            label="Channel"
            value={channel}
            onChange={(ev) => setChannel(ev.target.value)}
          >
            <option value="email">Email preview</option>
            <option value="whatsapp">WhatsApp preview</option>
          </SelectField>
          <TextField
            id="outbox-label"
            label="Label"
            value={templateLabel}
            onChange={(ev) => setTemplateLabel(ev.target.value)}
          />
          <TextAreaField
            id="outbox-body"
            label="Preview text"
            value={body}
            onChange={(ev) => setBody(ev.target.value)}
          />
          <label className="flex items-start gap-2 text-sm text-navy-800">
            <input
              type="checkbox"
              className="mt-1"
              checked={consent}
              onChange={(ev) => setConsent(ev.target.checked)}
            />
            The client opted in, and the opt-in names this firm. This checkbox is a firm record, not
            a provider approval.
          </label>
          <Button type="submit" loading={act.busy} disabled={!consent}>
            Submit for review
          </Button>
        </form>
      )}
    </>
  );
}
