import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ClamAvScanProvider, DisabledScanProvider, SCAN_PROVIDER } from './scan.provider';
import { ScanService } from './scan.service';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    ScanService,
    {
      provide: SCAN_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.SCAN_PROVIDER === 'clamav'
          ? new ClamAvScanProvider(env.CLAMAV_HOST, env.CLAMAV_PORT)
          : new DisabledScanProvider(),
    },
  ],
  exports: [ScanService],
})
export class DocumentsModule {}
