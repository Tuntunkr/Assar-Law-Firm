import { Global, Module } from '@nestjs/common';
import { ClientSessionService } from './client-session.service';
import { PortalAuthService } from './portal-auth.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Global()
@Module({
  controllers: [PortalController],
  providers: [ClientSessionService, PortalAuthService, PortalService],
  exports: [ClientSessionService],
})
export class PortalModule {}
