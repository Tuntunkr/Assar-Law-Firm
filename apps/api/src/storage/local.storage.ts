import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { hmac, safeEqual } from '../common/crypto';
import type { Env } from '../config/env';
import { UPLOAD_CONTENT_TYPE, type SignedRequest, type StorageService } from './storage.service';

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

/**
 * Development/test driver: stores files on local disk and issues HMAC-signed URLs served by
 * `LocalStorageController`. Refused in production by env validation.
 */
export class LocalStorage implements StorageService {
  private readonly root: string;

  constructor(
    private readonly env: Pick<Env, 'STORAGE_LOCAL_DIR' | 'SESSION_SECRET' | 'publicApiUrl'>,
  ) {
    this.root = resolve(env.STORAGE_LOCAL_DIR);
  }

  /** Maps a key to a path strictly inside the storage root. */
  pathFor(key: string): string {
    if (!KEY_PATTERN.test(key) || key.split('/').some((p) => p === '..' || p === '.' || p === '')) {
      throw new Error('Invalid storage key');
    }
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return full;
  }

  private sign(op: 'put' | 'get', key: string, exp: number, extra: string) {
    return hmac(this.env.SESSION_SECRET, `storage:${op}:${key}:${exp}:${extra}`);
  }

  /** Verifies a signed URL's parameters. `extra` is the size (put) or filename (get). */
  verify(op: 'put' | 'get', key: string, exp: number, extra: string, sig: string): boolean {
    return (
      Number.isFinite(exp) &&
      exp * 1000 > Date.now() &&
      safeEqual(sig, this.sign(op, key, exp, extra))
    );
  }

  private url(op: 'put' | 'get', key: string, expiresInSeconds: number, extra: string) {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const q = new URLSearchParams({
      key,
      op,
      exp: String(exp),
      x: extra,
      sig: this.sign(op, key, exp, extra),
    });
    return {
      url: `${this.env.publicApiUrl}/internal/storage?${q}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  async createUploadRequest(
    key: string,
    o: { sizeBytes: number; expiresInSeconds: number },
  ): Promise<SignedRequest> {
    this.pathFor(key);
    const { url, expiresAt } = this.url('put', key, o.expiresInSeconds, String(o.sizeBytes));
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': UPLOAD_CONTENT_TYPE, 'content-length': String(o.sizeBytes) },
      expiresAt,
    };
  }

  async createDownloadRequest(
    key: string,
    o: { filename: string; expiresInSeconds: number },
  ): Promise<SignedRequest> {
    this.pathFor(key);
    const { url, expiresAt } = this.url('get', key, o.expiresInSeconds, o.filename);
    return { url, method: 'GET', headers: {}, expiresAt };
  }

  async head(key: string) {
    try {
      return { sizeBytes: (await stat(this.pathFor(key))).size };
    } catch {
      return null;
    }
  }

  async read(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Streams a request body to disk, enforcing the exact signed size. Returns false on mismatch. */
  async writeFrom(key: string, body: Readable, expectedSize: number): Promise<boolean> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.part`;
    let written = 0;
    const out = createWriteStream(tmp);
    try {
      await new Promise<void>((ok, fail) => {
        body.on('data', (chunk: Buffer) => {
          written += chunk.length;
          if (written > expectedSize) body.destroy(new Error('too large'));
        });
        body.on('error', fail);
        out.on('error', fail);
        out.on('finish', ok);
        body.pipe(out);
      });
    } catch {
      await rm(tmp, { force: true });
      return false;
    }
    if (written !== expectedSize) {
      await rm(tmp, { force: true });
      return false;
    }
    await rename(tmp, target);
    return true;
  }
}
