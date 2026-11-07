import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  changePasswordSchema,
  portalAcceptInvitationSchema,
  portalLoginSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, ClientContext } from '../common/auth-context';
import { Client, ClientPortal, Public } from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { AUTH_THROTTLE } from '../common/rate-limits';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, type Env } from '../config/env';
import { cookieBase, cookieNames } from '../security/cookies';
import { PortalAuthService } from './portal-auth.service';
import { PortalService } from './portal.service';

const versionNo = (v: string) => {
  if (!/^\d{1,6}$/.test(v)) throw new ApiError(404, 'NOT_FOUND', 'Not found');
  return Number(v);
};

@ClientPortal()
@Controller('portal')
export class PortalController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.names = cookieNames(this.env.cookieSecure);
  }

  private readonly names: ReturnType<typeof cookieNames>;

  private setCookies(res: Response, s: { raw: string; csrf: string; maxAgeMs: number }) {
    const base = { ...cookieBase(this.env.cookieSecure), maxAge: s.maxAgeMs };
    res.cookie(this.names.portalSession, s.raw, { ...base, httpOnly: true });
    res.cookie(this.names.portalCsrf, s.csrf, { ...base, httpOnly: false });
  }

  private clearCookies(res: Response) {
    const base = cookieBase(this.env.cookieSecure);
    res.clearCookie(this.names.portalSession, { ...base, httpOnly: true });
    res.clearCookie(this.names.portalCsrf, { ...base, httpOnly: false });
  }

  // ---- authentication ----

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @Post('auth/login')
  async login(
    @Body(new ZodPipe(portalLoginSchema)) body: z.infer<typeof portalLoginSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, body: me } = await this.auth.login(body, req);
    this.setCookies(res, session);
    return me;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('auth/accept-invitation')
  async acceptInvitation(
    @Body(new ZodPipe(portalAcceptInvitationSchema))
    body: z.infer<typeof portalAcceptInvitationSchema>,
    @Req() req: AppRequest,
  ) {
    await this.auth.acceptInvitation(body, req);
    return { ok: true };
  }

  @HttpCode(204)
  @Post('auth/logout')
  async logout(
    @Client() c: ClientContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(c, req);
    this.clearCookies(res);
  }

  @HttpCode(204)
  @Throttle(AUTH_THROTTLE)
  @Post('auth/change-password')
  async changePassword(
    @Client() c: ClientContext,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() req: AppRequest,
  ) {
    await this.auth.changePassword(c, body, req);
  }

  @Get('me')
  me(@Client() c: ClientContext) {
    return this.auth.me(c);
  }

  // ---- data (read-only, bound to the signed-in client) ----

  @Get('matters')
  matters(@Client() c: ClientContext) {
    return this.portal.matters(c);
  }

  @Get('matters/:id')
  matter(@Client() c: ClientContext, @Param('id', ObjectIdPipe) id: string) {
    return this.portal.matter(c, id);
  }

  @Get('matters/:id/documents')
  documents(@Client() c: ClientContext, @Param('id', ObjectIdPipe) id: string) {
    return this.portal.documents(c, id);
  }

  @HttpCode(200)
  @Post('documents/:id/versions/:version/download-link')
  downloadLink(
    @Client() c: ClientContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('version') v: string,
    @Req() req: AppRequest,
  ) {
    return this.portal.downloadLink(c, id, versionNo(v), req);
  }

  @Get('matters/:id/invoices')
  invoices(@Client() c: ClientContext, @Param('id', ObjectIdPipe) id: string) {
    return this.portal.invoices(c, id);
  }

  @Get('matters/:id/messages')
  messages(@Client() c: ClientContext, @Param('id', ObjectIdPipe) id: string) {
    return this.portal.messages(c, id);
  }

  @Get('matters/:id/ai-outputs')
  aiOutputs(@Client() c: ClientContext, @Param('id', ObjectIdPipe) id: string) {
    return this.portal.aiOutputs(c, id);
  }

  @Get('ai-outputs/:id')
  aiOutput(@Client() c: ClientContext, @Param('id', ObjectIdPipe) id: string) {
    return this.portal.aiOutput(c, id);
  }
}
