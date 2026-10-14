import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env';
import {
  UPLOAD_CONTENT_TYPE,
  contentDisposition,
  type SignedRequest,
  type StorageService,
} from './storage.service';

/** S3-compatible storage (AWS S3, MinIO, ...). The bucket must be private. */
export class S3Storage implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    env: Pick<
      Env,
      | 'S3_ENDPOINT'
      | 'S3_REGION'
      | 'S3_BUCKET'
      | 'S3_ACCESS_KEY'
      | 'S3_SECRET_KEY'
      | 'S3_FORCE_PATH_STYLE'
    >,
  ) {
    this.bucket = env.S3_BUCKET!;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! },
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
      if (
        (e as { name?: string }).name === 'NotFound' ||
        (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      )
        return null;
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
