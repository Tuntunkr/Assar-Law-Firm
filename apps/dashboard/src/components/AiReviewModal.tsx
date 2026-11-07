import type { AiOutputDto } from '@assar/api-client';
import { Alert, Button, Modal, StatusPill, TextAreaField, TextField } from '@assar/ui';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { label } from '../lib/format';
import { useAction } from '../lib/useAction';

interface Result {
  title?: string;
  body?: string;
  answerable?: boolean;
  items?: { label?: string; text?: string; verified?: boolean }[];
  assumptions?: string[];
  verification?: {
    status?: string;
    itemsTotal?: number;
    itemsVerified?: number;
    unsupportedAuthorities?: string[];
    notes?: string[];
  };
}

/** Review an AI draft: read it with its verification, edit, then approve or reject. */
export function AiReviewModal({
  output,
  onClose,
  onChanged,
}: {
  output: AiOutputDto;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { client, can } = useAuth();
  const act = useAction();
  const r = (output.result ?? {}) as Result;
  const v = r.verification;
  const needsAck = v?.status !== 'all_verified' || (v?.unsupportedAuthorities?.length ?? 0) > 0;
  const draft = output.reviewStatus === 'draft';
  const [text, setText] = useState(output.editedText ?? r.body ?? '');
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  return (
    <Modal open onClose={onClose} title={r.title || label(output.task)} wide>
      <div className="space-y-4">
        <Alert tone={draft ? 'info' : output.reviewStatus === 'approved' ? 'success' : 'error'}>
          {output.label}
        </Alert>
        {v && (
          <div className="rounded-lg border border-navy-100 bg-navy-50/60 p-3 text-sm">
            <p className="font-medium">
              Verification: {label(v.status ?? 'unknown')}
              {v.itemsTotal != null &&
                ` (${v.itemsVerified ?? 0}/${v.itemsTotal} items matched the sources)`}
            </p>
            {(v.unsupportedAuthorities?.length ?? 0) > 0 && (
              <p className="mt-1 text-red-800">
                Authorities not found in sources: {v.unsupportedAuthorities!.join('; ')}
              </p>
            )}
            {v.notes?.map((n) => (
              <p key={n} className="mt-1 text-navy-700">
                {n}
              </p>
            ))}
          </div>
        )}
        {draft && can('ai:approve') ? (
          <TextAreaField
            id="aitext"
            label="Text (edit before approving)"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <p className="whitespace-pre-wrap rounded-lg border border-navy-100 p-3 text-sm">
            {output.editedText ?? r.body}
          </p>
        )}
        {(r.items?.length ?? 0) > 0 && (
          <ul className="space-y-2 text-sm">
            {r.items!.map((i, n) => (
              <li key={n} className="flex gap-2">
                <StatusPill tone={i.verified ? 'green' : 'amber'}>
                  {i.verified ? 'verified' : 'unverified'}
                </StatusPill>
                <span>
                  <span className="font-medium">{i.label}</span> {i.text}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(r.assumptions?.length ?? 0) > 0 && (
          <p className="text-xs text-navy-600">Assumptions: {r.assumptions!.join('; ')}</p>
        )}
        {output.reviewNote && (
          <p className="text-sm text-navy-700">Review note: {output.reviewNote}</p>
        )}

        {draft &&
          can('ai:approve') &&
          (rejecting ? (
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await act.run(() => client.rejectAiOutput(output.id, reason), 'Output rejected')
                )
                  onChanged();
              }}
            >
              <TextField
                id="rej"
                label="Reason for rejecting"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                error={act.errors.reason}
                required
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setRejecting(false)}>
                  Back
                </Button>
                <Button type="submit" loading={act.busy}>
                  Reject
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <TextField
                id="ainote"
                label="Review note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              {needsAck && (
                <label className="flex items-start gap-2 text-sm text-amber-900">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  I have reviewed the unverified items and unsupported authorities above and accept
                  responsibility for this output.
                </label>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => setRejecting(true)}>
                  Reject
                </Button>
                <Button
                  loading={act.busy}
                  disabled={needsAck && !ack}
                  onClick={async () => {
                    const edited = text.trim() && text.trim() !== (r.body ?? '').trim();
                    if (
                      edited &&
                      !(await act.run(() => client.editAiOutput(output.id, text.trim())))
                    )
                      return;
                    if (
                      await act.run(
                        () =>
                          client.approveAiOutput(output.id, {
                            acknowledgeUnverified: ack,
                            ...(note ? { note } : {}),
                          }),
                        'Output approved',
                      )
                    )
                      onChanged();
                  }}
                >
                  Approve
                </Button>
              </div>
            </div>
          ))}
        {output.reviewStatus === 'approved' && can('portal:manage') && (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              loading={act.busy}
              onClick={() =>
                act.run(() => client.shareAiOutput(output.id, true), 'Shared with client portal')
              }
            >
              Share with client
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
