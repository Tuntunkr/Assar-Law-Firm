import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { conflictCheckSchema } from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ConflictsService } from './conflicts.service';

@Controller('conflict-checks')
export class ConflictsController {
  constructor(private readonly conflicts: ConflictsService) {}

  @RequirePermissions('conflict:check')
  @HttpCode(200)
  @Post()
  check(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(conflictCheckSchema)) body: z.infer<typeof conflictCheckSchema>,
    @Req() req: AppRequest,
  ) {
    return this.conflicts.check(auth, body.names, req);
  }
}
