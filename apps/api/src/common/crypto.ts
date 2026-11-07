import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'assar-salt', 'mfa-secret-encryption', 32));
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

/** Tries each key in turn (current first). AES-GCM authentication makes a wrong key fail cleanly, never return garbage. */
export function decryptWithKeys(payload: string, keys: (string | undefined)[]): string {
  let last: unknown = new Error('No decryption key configured');
  for (const k of keys) {
    if (!k) continue;
    try {
      return decryptSecret(payload, k);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
