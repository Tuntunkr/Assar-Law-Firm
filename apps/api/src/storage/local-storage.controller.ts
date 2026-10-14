import { Controller, Get, HttpCode, Inject, Put, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import {
  contentDisposition,
  STORAGE,
  UPLOAD_CONTENT_TYPE,
  type StorageService,
} from './storage.service';
import { LocalStorage } from './local.storage';

/**
 * Serves signed URLs for the local development driver only. Authentication is the HMAC signature;
 * it is not mounted under /v1 and does nothing when another driver is configured.
 */
@Public()
@SkipThrottle()
@Controller('internal/storage')
export class LocalStorageController {
  constructor(@Inject(STORAGE) private readonly storage: StorageService) {}

  private local(): LocalStorage {
    if (!(this.storage instanceof LocalStorage)) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    return this.storage;
  }

  @HttpCode(200)
  @Put()
  async put(@Query() q: Record<string, string>, @Req() req: Request) {
    const store = this.local();
    const size = Number(q.x);
    if (
      q.op !== 'put' ||
      !q.key ||
      !store.verify('put', q.key, Number(q.exp), q.x ?? '', q.sig ?? '')
    ) {
      throw new ApiError(403, 'FORBIDDEN', 'Invalid or expired upload link');
    }
    if (
      req.header('content-type') !== UPLOAD_CONTENT_TYPE ||
      Number(req.header('content-length')) !== size
    ) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'Upload headers do not match the signed request',
      );
    }
    if (!(await store.writeFrom(q.key, req, size))) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'Uploaded size does not match the declared size',
      );
    }
    return { ok: true };
  }

  @Get()
  async get(@Query() q: Record<string, string>, @Res() res: Response) {
    const store = this.local();
    if (
      q.op !== 'get' ||
      !q.key ||
      !store.verify('get', q.key, Number(q.exp), q.x ?? '', q.sig ?? '')
    ) {
      throw new ApiError(403, 'FORBIDDEN', 'Invalid or expired download link');
    }
    if (!(await store.head(q.key))) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    res.setHeader('content-type', UPLOAD_CONTENT_TYPE);
    res.setHeader('content-disposition', contentDisposition(q.x ?? 'download'));
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'private, no-store');
    (await store.read(q.key)).pipe(res);
  }
}
