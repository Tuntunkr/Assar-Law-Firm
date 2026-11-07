import { ALLOWED_UPLOAD_TYPES } from '@assar/validation';
import type { StaffClient, UploadRequest } from '@assar/api-client';

export const ACCEPT = ALLOWED_UPLOAD_TYPES.join(',');

/** Why a file cannot be uploaded, or null if it looks fine. The API re-checks everything. */
export function fileProblem(file: File, maxBytes = 50 * 1024 * 1024): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > maxBytes)
    return `That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type))
    return 'This file type is not supported. Use PDF, Word, Excel, text, RTF, e-mail, or an image (PNG, JPEG, TIFF).';
  return null;
}

/** Sends the bytes to the signed storage URL. Content-Length is set by the browser from the body. */
export async function putToStorage(upload: UploadRequest, file: File): Promise<void> {
  const headers = Object.fromEntries(
    Object.entries(upload.headers).filter(([k]) => k.toLowerCase() !== 'content-length'),
  );
  let res: Response;
  try {
    res = await fetch(upload.url, { method: upload.method, headers, body: file });
  } catch {
    throw new Error('The upload could not reach storage. Check your connection and try again.');
  }
  if (!res.ok)
    throw new Error('Storage rejected the upload. The link may have expired; try again.');
}

/** Versions a person may open: scanned clean, or scanning is switched off for this environment. */
export const isUsable = (status: string) => status === 'clean' || status === 'skipped';

export type UploadStage = 'preparing' | 'uploading' | 'scanning' | 'done';

/**
 * Create (or add a version to) a document, upload the file, mark it complete, then wait for the
 * security scan. A file is only usable once the scan finds it clean.
 */
export async function uploadDocument(
  client: StaffClient,
  file: File,
  target: { matterId: string; title: string } | { documentId: string },
  onStage: (s: UploadStage) => void,
): Promise<{
  documentId: string;
  version: number;
  scan: 'clean' | 'skipped' | 'blocked' | 'pending';
}> {
  const meta = { filename: file.name, contentType: file.type, sizeBytes: file.size };
  onStage('preparing');
  const created =
    'documentId' in target
      ? await client.addDocumentVersion(target.documentId, meta)
      : await client.createDocument(target.matterId, { title: target.title, ...meta });
  onStage('uploading');
  await putToStorage(created.upload, file);
  await client.completeDocumentVersion(created.document.id, created.version.version);
  onStage('scanning');
  let status = 'scanning';
  for (let i = 0; i < 20 && (status === 'scanning' || status === 'pending_upload'); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const doc = await client.document(created.document.id);
    status = doc.versions.find((v) => v.version === created.version.version)?.status ?? status;
  }
  onStage('done');
  return {
    documentId: created.document.id,
    version: created.version.version,
    scan:
      status === 'clean' || status === 'skipped'
        ? status
        : status === 'scanning'
          ? 'pending'
          : 'blocked',
  };
}
