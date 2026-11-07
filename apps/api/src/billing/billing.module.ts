import { Module } from '@nestjs/common';
import { BillingSettingsController } from './settings.controller';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { TimeController } from './time.controller';
import { TimeService } from './time.service';

@Module({
  controllers: [TimeController, InvoicesController, ReportsController, BillingSettingsController],
  providers: [TimeService, InvoicesService, ReportsService],
})
export class BillingModule {}
