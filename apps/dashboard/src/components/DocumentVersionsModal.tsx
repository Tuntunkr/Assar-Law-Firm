import { Alert, Button, Modal, StatusPill } from '@assar/ui';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { isUsable } from '../lib/upload';
import { formatBytes, formatDateTime, label, toneOf } from '../lib/format';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';
import { SimilarDocuments } from './SimilarDocuments';
import { UploadModal } from './UploadModal';
import { RereadButton, TextBadge, VersionTextModal } from './VersionText';

/** Versions of one document: download, share with the client portal, or upload a new version. */
export function DocumentVersionsModal({
  documentId,
  onClose,
  onChanged,
}: {
  documentId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { client, can } = useAuth();
  const act = useAction();
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState<number | null>(null);
  const [showSimilar, setShowSimilar] = useState(false);
  const detail = useAsync(
    () => (documentId ? client.document(documentId) : Promise.resolve(null)),
    [client, documentId],
  );
  return (
    <>
      <Modal
        open={!!documentId}
        onClose={onClose}
        title={detail.status === 'ready' && detail.data ? detail.data.title : 'Document'}
        wide
      >
        {detail.status === 'ready' && detail.data && (
          <div className="space-y-3">
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowSimilar((x) => !x)}>
                {showSimilar ? 'Hide similar documents' : 'Find similar documents'}
              </Button>
              {can('document:write') && (
                <Button variant="secondary" onClick={() => setUploading(true)}>
                  Upload new version
                </Button>
              )}
            </div>
            {showSimilar && <SimilarDocuments documentId={detail.data.id} />}
            <ul className="divide-y divide-navy-50 text-sm">
              {[...detail.data.versions].reverse().map((v) => (
                <li
                  key={v.version}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <p className="font-medium">
                      v{v.version} · {v.filename}
                    </p>
                    <p className="text-xs text-navy-600">
                      {formatBytes(v.sizeBytes)} · {formatDateTime(v.createdAt)} ·{' '}
                      <StatusPill tone={toneOf(v.status)}>{label(v.status)}</StatusPill>
                    </p>
                    {isUsable(v.status) && (
                      <p className="mt-1">
                        <TextBadge text={v.text} />
                        {v.text?.status === 'failed' && v.text.error && (
                          <span className="ml-2 text-xs text-red-700">{v.text.error.message}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {v.text?.status === 'done' && (
                      <Button variant="ghost" onClick={() => setReading(v.version)}>
                        View text
                      </Button>
                    )}
                    {isUsable(v.status) && (!v.text || v.text.status === 'failed') && (
                      <RereadButton
                        documentId={detail.data!.id}
                        version={v.version}
                        onDone={detail.reload}
                      />
                    )}
                    <Button
                      variant="secondary"
                      disabled={act.busy || !isUsable(v.status)}
                      onClick={async () => {
                        const l = await act.run(() =>
                          client.downloadLink(detail.data!.id, v.version),
                        );
                        if (l) window.open(l.url, '_blank', 'noopener');
                      }}
                    >
                      Download
                    </Button>
                    {can('portal:manage') && isUsable(v.status) && (
                      <Button
                        variant="ghost"
                        disabled={act.busy}
                        onClick={() =>
                          act.run(
                            () => client.shareVersion(detail.data!.id, v.version, true),
                            'Shared with the client portal',
                          )
                        }
                      >
                        Share with client
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {detail.status === 'error' && <Alert tone="error">{detail.error.message}</Alert>}
      </Modal>
      {documentId && reading !== null && (
        <VersionTextModal
          documentId={documentId}
          version={reading}
          open
          onClose={() => setReading(null)}
        />
      )}
      <UploadModal
        open={uploading}
        documentId={documentId ?? undefined}
        onClose={() => setUploading(false)}
        onUploaded={() => {
          detail.reload();
          onChanged?.();
        }}
      />
    </>
  );
}
