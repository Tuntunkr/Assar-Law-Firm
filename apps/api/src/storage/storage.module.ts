import { Global, Module } from '@nestjs/common';
import { LocalStorage, S3Storage } from '@assar/storage';
import { ENV, type Env } from '../config/env';
import { LocalStorageController } from './local-storage.controller';
import { STORAGE } from './storage.token';

export function createStorage(env: Env) {
  return env.STORAGE_DRIVER === 's3'
    ? new S3Storage({
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION,
        accessKey: env.S3_ACCESS_KEY!,
        secretKey: env.S3_SECRET_KEY!,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      })
    : new LocalStorage({
        directory: env.STORAGE_LOCAL_DIR,
        signingSecret: env.SESSION_SECRET,
        publicBaseUrl: env.publicApiUrl,
      });
}

@Global()
@Module({
  controllers: [LocalStorageController],
  providers: [{ provide: STORAGE, inject: [ENV], useFactory: createStorage }],
  exports: [STORAGE],
})
export class StorageModule {}
