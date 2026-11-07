import { describe, expect, it } from 'vitest';
import { S3Storage } from './s3.js';

const storage = new S3Storage({
  endpoint: 'http://minio.test:9000',
  region: 'us-east-1',
  bucket: 'assar-private',
  accessKey: 'AKIATESTTESTTESTTEST', // secrets:ignore (fake key; the test only checks URL signing)
  secretKey: 'test-secret-key-test-secret-key',
  forcePathStyle: true,
});

// These checks only cover URL signing (no network). Behaviour against a real bucket is not covered here.
describe('S3Storage presigned requests', () => {
  it('signs a time-limited PUT bound to size and content type', async () => {
    const r = await storage.createUploadRequest('org/o1/doc/d1/v1-abc', {
      sizeBytes: 1234,
      expiresInSeconds: 900,
    });
    const u = new URL(r.url);
    expect(u.origin + u.pathname).toBe('http://minio.test:9000/assar-private/org/o1/doc/d1/v1-abc');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toMatch(/content-length/);
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toMatch(/content-type/);
    expect(r.method).toBe('PUT');
    expect(r.headers).toEqual({
      'content-type': 'application/octet-stream',
      'content-length': '1234',
    });
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('signs a short-lived GET that forces download', async () => {
    const r = await storage.createDownloadRequest('org/o1/doc/d1/v1-abc', {
      filename: 'Contract "final".pdf',
      expiresInSeconds: 300,
    });
    const u = new URL(r.url);
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(u.searchParams.get('response-content-disposition')).toMatch(/^attachment;/);
    expect(u.searchParams.get('response-content-disposition')).not.toMatch(/filename="Contract "/); // quote escaped
    expect(u.searchParams.get('response-content-type')).toBe('application/octet-stream');
  });
});
