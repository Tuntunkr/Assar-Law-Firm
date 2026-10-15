import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  createPortalInvitationSchema,
  setMatterPortalSchema,
  setSharedSchema,
  updatePortalUserSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Idempotent, RequirePermissions } from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { PortalAdminService } from './portal-admin.service';

const versionNo = (v: string) => {
  if (!/^\d{1,6}$/.test(v)) throw new ApiError(404, 'NOT_FOUND', 'Version not found');
  return Number(v);
};

/** Staff controls for the client portal. Publishing anything to a client needs `portal:manage`. */
@RequirePermissions('portal:manage')
@Controller()
export class PortalAdminController {
  constructor(private readonly admin: PortalAdminService) {}

  @Idempotent({ redact: ['token'], optional: true })
  @Post('clients/:id/portal-invitations')
  invite(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(createPortalInvitationSchema))
    body: z.infer<typeof createPortalInvitationSchema>,
    @Req() req: AppRequest,
  ) {
    return this.admin.invite(auth, id, body, req);
  }

  @Get('clients/:id/portal-access')
  access(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string) {
    return this.admin.accessFor(auth, id);
  }

  @HttpCode(204)
  @Delete('clients/:id/portal-invitations/:invitationId')
  async revoke(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('invitationId') invId: string,
    @Req() req: AppRequest,
  ) {
    await this.admin.revokeInvitation(auth, id, invId, req);
  }

  @Patch('clients/:id/portal-users/:userId')
  setUserStatus(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('userId', ObjectIdPipe) userId: string,
    @Body(new ZodPipe(updatePortalUserSchema)) body: z.infer<typeof updatePortalUserSchema>,
    @Req() req: AppRequest,
  ) {
    return this.admin.setUserStatus(auth, id, userId, body.status, req);
  }

  @Put('matters/:id/portal')
  setMatterPortal(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(setMatterPortalSchema)) body: z.infer<typeof setMatterPortalSchema>,
    @Req() req: AppRequest,
  ) {
    return this.admin.setMatterPortal(auth, id, body, req);
  }

  @Put('documents/:id/versions/:version/share')
  shareVersion(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('version') v: string,
    @Body(new ZodPipe(setSharedSchema)) body: z.infer<typeof setSharedSchema>,
    @Req() req: AppRequest,
  ) {
    return this.admin.setVersionShared(auth, id, versionNo(v), body.shared, req);
  }

  @Put('ai/outputs/:id/share')
  shareOutput(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(setSharedSchema)) body: z.infer<typeof setSharedSchema>,
    @Req() req: AppRequest,
  ) {
    return this.admin.setOutputShared(auth, id, body.shared, req);
  }
}
