import { Global, Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { NotificationsController } from './notifications.controller';
import { ServiceAuthService } from './service-auth.service';
import { ServiceTokensController } from './service-tokens.controller';

@Global()
@Module({
  controllers: [AutomationController, ServiceTokensController, NotificationsController],
  providers: [AutomationService, ServiceAuthService],
  exports: [ServiceAuthService],
})
export class AutomationModule {}
