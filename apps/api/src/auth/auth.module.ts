import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, TotpService],
  exports: [SessionService, PasswordService, TotpService],
})
export class AuthModule {}
