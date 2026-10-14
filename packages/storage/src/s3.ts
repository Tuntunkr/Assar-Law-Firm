import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  UPLOAD_CONTENT_TYPE,
  contentDisposition,
  type SignedRequest,
  type StorageService,
} from './storage.js';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

/** S3-compatible storage (AWS S3, MinIO, ...). The bucket must be private. */
export class S3Storage implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? false,
      credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
    });
  }

  async createUploadRequest(
    key: string,
    o: { sizeBytes: number; expiresInSeconds: number },
  ): Promise<SignedRequest> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: UPLOAD_CONTENT_TYPE,
      ContentLength: o.sizeBytes,
    });
    const url = await getSignedUrl(this.client, cmd, {
      expiresIn: o.expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': UPLOAD_CONTENT_TYPE, 'content-length': String(o.sizeBytes) },
      expiresAt: new Date(Date.now() + o.expiresInSeconds * 1000),
    };
  }

  async createDownloadRequest(
    key: string,
    o: { filename: string; expiresInSeconds: number },
  ): Promise<SignedRequest> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition(o.filename),
      ResponseContentType: UPLOAD_CONTENT_TYPE,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: o.expiresInSeconds });
    return {
      url,
      method: 'GET',
      headers: {},
      expiresAt: new Date(Date.now() + o.expiresInSeconds * 1000),
    };
  }

  async head(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0 };
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async read(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
