import { Alert, Button, Modal, TextField } from '@assar/ui';
import { useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { ACCEPT, fileProblem, uploadDocument, type UploadStage } from '../lib/upload';
import { errorText } from '../lib/useAction';
import { MatterPicker } from './Pickers';

const STAGE_TEXT: Record<UploadStage, string> = {
  preparing: 'Preparing…',
  uploading: 'Uploading…',
  scanning: 'Running the security scan…',
  done: 'Done',
};

/** Upload a new document to a matter, or a new version of an existing document. */
export function UploadModal({
  open,
  onClose,
  onUploaded,
  matterId,
  documentId,
  clientId,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  matterId?: string;
  documentId?: string;
  /** Limits the matter choices to one client's matters. */
  clientId?: string;
}) {
  const { client } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [matter, setMatter] = useState(matterId ?? '');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'clean' | 'skipped' | 'blocked' | 'pending' | null>(null);
  const busy = stage !== null && stage !== 'done';

  const reset = () => {
    setFile(null);
    setTitle('');
    setStage(null);
    setError(null);
    setResult(null);
    if (input.current) input.current.value = '';
  };
  const close = () => {
    if (busy) return;
    if (result) onUploaded();
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={documentId ? 'Upload a new version' : 'Upload document'}
    >
      {result ? (
        <div className="space-y-3">
          {result === 'clean' && (
            <Alert tone="success">Uploaded. The security scan found no problems.</Alert>
          )}
          {result === 'skipped' && (
            <Alert tone="info">
              Uploaded. Virus scanning is turned off in this environment, so the file was not
              scanned.
            </Alert>
          )}
          {result === 'pending' && (
            <Alert tone="info">
              Uploaded. The security scan is still running; the file becomes available when it
              finishes.
            </Alert>
          )}
          {result === 'blocked' && (
            <Alert tone="error">
              The file failed the security scan and is unavailable. It was not shared with anyone.
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset}>
              Upload another
            </Button>
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return setError('Choose a file to upload.');
            const problem = fileProblem(file);
            if (problem) return setError(problem);
            if (!documentId && !matter)
              return setError('Choose the matter this document belongs to.');
            setError(null);
            try {
              const r = await uploadDocument(
                client,
                file,
                documentId
                  ? { documentId }
                  : { matterId: matter, title: title.trim() || file.name.replace(/\.[^.]+$/, '') },
                setStage,
              );
              setResult(r.scan);
            } catch (err) {
              setStage(null);
              setError(err instanceof Error && !('status' in err) ? err.message : errorText(err));
            }
          }}
        >
          {error && <Alert tone="error">{error}</Alert>}
          {!documentId && !matterId && (
            <MatterPicker
              id="umatter"
              label="Matter"
              clientId={clientId}
              value={matter}
              onChange={setMatter}
              required
            />
          )}
          {!documentId && (
            <TextField
              id="utitle"
              label="Title"
              hint="Defaults to the file name."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
          <div>
            <label htmlFor="ufile" className="mb-1 block text-sm font-medium text-navy-900">
              File
            </label>
            <input
              ref={input}
              id="ufile"
              type="file"
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
              className="block w-full rounded-lg border border-dashed border-navy-200 bg-white px-3 py-6 text-sm text-navy-700 file:mr-3 file:rounded-md file:border-0 file:bg-accent-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
            />
            <p className="mt-1 text-xs text-navy-600">
              PDF, Word, Excel, text, RTF, e-mail or image. Files are scanned before anyone can open
              them.
            </p>
          </div>
          {stage && (
            <p role="status" className="text-sm text-navy-700">
              {STAGE_TEXT[stage]}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Upload
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
