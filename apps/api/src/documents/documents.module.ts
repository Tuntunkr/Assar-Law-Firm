import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ScanService } from './scan.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, ScanService],
  exports: [ScanService],
})
export class DocumentsModule {}
