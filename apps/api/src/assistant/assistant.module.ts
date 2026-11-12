import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ClientsModule } from '../clients/clients.module';
import { TasksModule } from '../tasks/tasks.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [TasksModule, ClientsModule, CalendarModule, BillingModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
