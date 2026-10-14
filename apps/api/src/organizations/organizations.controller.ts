import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  auditQuerySchema,
  createInvitationSchema,
  paginationSchema,
  updateMemberSchema,
  updateOrganizationSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Idempotent, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { OrganizationsService } from './organizations.service';

@Controller()
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('organization')
  get(@Auth() auth: AuthContext) {
    return this.orgs.get(auth);
  }

  @RequirePermissions('org:manage')
  @Patch('organization')
  rename(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(updateOrganizationSchema)) body: z.infer<typeof updateOrganizationSchema>,
    @Req() req: AppRequest,
  ) {
    return this.orgs.rename(auth, body.name, req);
  }

  @RequirePermissions('user:manage')
  @Get('organization/members')
  members(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(paginationSchema)) q: z.infer<typeof paginationSchema>,
  ) {
    return this.orgs.listMembers(auth, q);
  }

  @RequirePermissions('user:manage')
  @Patch('organization/members/:userId')
  updateMember(
    @Auth() auth: AuthContext,
    @Param('userId') userId: string,
    @Body(new ZodPipe(updateMemberSchema)) body: z.infer<typeof updateMemberSchema>,
    @Req() req: AppRequest,
  ) {
    return this.orgs.updateMember(auth, userId, body, req);
  }

  @RequirePermissions('user:manage')
  @Idempotent({ redact: ['token'] })
  @Post('organization/invitations')
  invite(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createInvitationSchema)) body: z.infer<typeof createInvitationSchema>,
    @Req() req: AppRequest,
  ) {
    return this.orgs.createInvitation(auth, body, req);
  }

  @RequirePermissions('user:manage')
  @Get('organization/invitations')
  invitations(@Auth() auth: AuthContext) {
    return this.orgs.listInvitations(auth);
  }

  @RequirePermissions('user:manage')
  @HttpCode(204)
  @Delete('organization/invitations/:id')
  async revoke(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    await this.orgs.revokeInvitation(auth, id, req);
  }

  @RequirePermissions('audit:read')
  @Get('audit-logs')
  audit(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>,
  ) {
    return this.orgs.auditLog(auth, q);
  }
}
