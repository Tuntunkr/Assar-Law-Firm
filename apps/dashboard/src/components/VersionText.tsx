import type { TextStatusDto } from '@assar/api-client';
import { Alert, Button, Modal, Skeleton, StatusPill } from '@assar/ui';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

const METHOD: Record<string, string> = {
  text: 'Read from file',
  ocr: 'Scanned (OCR)',
  mixed: 'Text + scanned pages',
};

/** One line about how a version's text was obtained, e.g. "Scanned (OCR) · 93% confident · 2 pages". */
export function TextBadge({ text }: { text: TextStatusDto | null | undefined }) {
  if (!text) return <StatusPill tone="gray">text not read</StatusPill>;
  if (text.status === 'failed') return <StatusPill tone="red">text unreadable</StatusPill>;
  if (text.status !== 'done') return <StatusPill tone="amber">reading text…</StatusPill>;
  const low = text.confidence != null && text.confidence < 70;
  return (
    <StatusPill tone={low ? 'amber' : 'green'}>
      {METHOD[text.method ?? 'text']}
      {text.confidence != null ? ` · ${text.confidence}% confident` : ''}
      {text.pages ? ` · ${text.pages} page${text.pages === 1 ? '' : 's'}` : ''}
    </StatusPill>
  );
}

/** Reads the extracted text of a version in a dialog; long documents show a preview with "Show all". */
export function VersionTextModal({
  documentId,
  version,
  open,
  onClose,
}: {
  documentId: string;
  version: number;
  open: boolean;
  onClose: () => void;
}) {
  const { client } = useAuth();
  const [full, setFull] = useState(false);
  const state = useAsync(
    () => (open ? client.versionText(documentId, version, full) : Promise.resolve(null)),
    [client, documentId, version, open, full],
  );
  return (
    <Modal open={open} onClose={onClose} title={`Text of version ${version}`} wide>
      {state.status === 'loading' && <Skeleton className="h-40 w-full" />}
      {state.status === 'error' && <Alert tone="error">{state.error.message}</Alert>}
      {state.status === 'ready' && state.data && (
        <div className="space-y-3">
          {state.data.status !== 'done' ? (
            <Alert tone={state.data.status === 'failed' ? 'error' : 'info'}>
              {state.data.status === 'failed'
                ? (state.data.error?.message ?? 'The text could not be read.')
                : state.data.status === 'none'
                  ? 'The text of this version has not been read yet.'
                  : 'The text is still being read. Try again in a moment.'}
            </Alert>
          ) : (
            <>
              {state.data.confidence != null && state.data.confidence < 70 && (
                <Alert tone="info">
                  The scan was hard to read ({state.data.confidence}% confidence), so the text below
                  may contain mistakes. Check it against the original.
                </Alert>
              )}
              {state.data.truncated && (
                <Alert tone="info">
                  Only part of this document could be read (it hit a size or page limit).
                </Alert>
              )}
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-navy-100 bg-navy-50/50 p-3 text-sm text-navy-900">
                {state.data.text}
              </pre>
              {state.data.textTruncated && (
                <Button variant="secondary" onClick={() => setFull(true)}>
                  Show all
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Re-reads a version whose text failed (or is stale). */
export function RereadButton({
  documentId,
  version,
  onDone,
}: {
  documentId: string;
  version: number;
  onDone: () => void;
}) {
  const { client, can } = useAuth();
  const act = useAction();
  if (!can('document:write')) return null;
  return (
    <Button
      variant="ghost"
      loading={act.busy}
      onClick={async () => {
        if (
          await act.run(
            () => client.extractVersionText(documentId, version),
            'Reading the text again',
          )
        )
          onDone();
      }}
    >
      Read again
    </Button>
  );
}
