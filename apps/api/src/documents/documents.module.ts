import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ScanService } from './scan.service';
import { TextService } from './text.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, ScanService, TextService],
  exports: [ScanService],
})
export class DocumentsModule {}
