import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { LocalStorageController } from './local-storage.controller';
import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import { STORAGE } from './storage.service';

@Global()
@Module({
  controllers: [LocalStorageController],
  providers: [
    {
      provide: STORAGE,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.STORAGE_DRIVER === 's3' ? new S3Storage(env) : new LocalStorage(env),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
