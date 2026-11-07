import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { conflictCheckSchema } from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RateLimit, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ConflictsService } from './conflicts.service';

@Controller('conflict-checks')
export class ConflictsController {
  constructor(private readonly conflicts: ConflictsService) {}

  @RequirePermissions('conflict:check')
  @RateLimit({ name: 'conflict-check', limit: 60, windowSeconds: 60 }) // scans client and party names
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
