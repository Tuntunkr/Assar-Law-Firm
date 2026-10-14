import type { Readable } from 'node:stream';

export const STORAGE = Symbol('STORAGE');

export interface SignedRequest {
  url: string;
  method: 'PUT' | 'GET';
  /** Headers the client must send exactly as given (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * Private object storage. Implementations never make objects public; access is only through
 * short-lived signed requests created here after the API has checked permissions.
 */
export interface StorageService {
  createUploadRequest(
    key: string,
    o: { sizeBytes: number; expiresInSeconds: number },
  ): Promise<SignedRequest>;
  createDownloadRequest(
    key: string,
    o: { filename: string; expiresInSeconds: number },
  ): Promise<SignedRequest>;
  /** Object metadata, or null if it doesn't exist. */
  head(key: string): Promise<{ sizeBytes: number } | null>;
  read(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/** Uploads always use this content type so the object itself is never served as renderable content. */
export const UPLOAD_CONTENT_TYPE = 'application/octet-stream';

export const contentDisposition = (filename: string) => {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};
