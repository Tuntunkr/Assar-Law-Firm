import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  registerSchema,
  updateProfileSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, AllowMfaEnrollment, Public } from '../common/decorators';
import { AUTH_THROTTLE } from '../common/rate-limits';
import { ZodPipe } from '../common/zod.pipe';
import { Inject } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { AuthService } from './auth.service';
import { cookieBase, cookieNames } from '../security/cookies';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.names = cookieNames(this.env.cookieSecure);
  }

  private readonly names: ReturnType<typeof cookieNames>;

  private setCookies(res: Response, s: { raw: string; csrf: string; maxAgeMs: number }) {
    const base = { ...cookieBase(this.env.cookieSecure), maxAge: s.maxAgeMs };
    res.cookie(this.names.session, s.raw, { ...base, httpOnly: true });
    // Readable by the SPA so it can echo the value in X-CSRF-Token.
    res.cookie(this.names.csrf, s.csrf, { ...base, httpOnly: false });
  }

  private clearCookies(res: Response) {
    const base = cookieBase(this.env.cookieSecure);
    res.clearCookie(this.names.session, { ...base, httpOnly: true });
    res.clearCookie(this.names.csrf, { ...base, httpOnly: false });
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(
    @Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, body: out } = await this.auth.register(body, req);
    this.setCookies(res, session);
    return out;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, body: out } = await this.auth.login(body, req);
    this.setCookies(res, session);
    return out;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('accept-invitation')
  async acceptInvitation(
    @Body(new ZodPipe(acceptInvitationSchema)) body: z.infer<typeof acceptInvitationSchema>,
    @Req() req: AppRequest,
  ) {
    await this.auth.acceptInvitation(body, req);
    return { ok: true };
  }

  @AllowMfaEnrollment()
  @HttpCode(204)
  @Post('logout')
  async logout(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(auth, req);
    this.clearCookies(res);
  }

  @AllowMfaEnrollment()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @Patch('profile')
  updateProfile(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>,
    @Req() req: AppRequest,
  ) {
    return this.auth.updateProfile(auth, body, req);
  }

  @Get('sessions')
  sessions(@Auth() auth: AuthContext) {
    return this.auth.listSessions(auth);
  }

  @HttpCode(204)
  @Post('sessions/revoke-others')
  async revokeOthers(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    await this.auth.revokeOtherSessions(auth, req);
  }

  @HttpCode(204)
  @Delete('sessions/:id')
  async revokeSession(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    await this.auth.revokeSession(auth, id, req);
  }

  @HttpCode(204)
  @Throttle(AUTH_THROTTLE)
  @Post('change-password')
  async changePassword(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() req: AppRequest,
  ) {
    await this.auth.changePassword(auth, body, req);
  }

  @AllowMfaEnrollment()
  @Post('mfa/setup')
  mfaSetup(@Auth() auth: AuthContext) {
    return this.auth.mfaSetup(auth);
  }

  @AllowMfaEnrollment()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @Post('mfa/enable')
  mfaEnable(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(mfaEnableSchema)) body: z.infer<typeof mfaEnableSchema>,
    @Req() req: AppRequest,
  ) {
    return this.auth.mfaEnable(auth, body.code, req);
  }

  @HttpCode(204)
  @Throttle(AUTH_THROTTLE)
  @Post('mfa/disable')
  async mfaDisable(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(mfaDisableSchema)) body: z.infer<typeof mfaDisableSchema>,
    @Req() req: AppRequest,
  ) {
    await this.auth.mfaDisable(auth, body, req);
  }
}
