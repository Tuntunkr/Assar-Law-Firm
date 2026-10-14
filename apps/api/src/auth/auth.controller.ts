import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  registerSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, AllowMfaEnrollment, Public } from '../common/decorators';
import { AUTH_THROTTLE } from '../common/rate-limits';
import { ZodPipe } from '../common/zod.pipe';
import { Inject } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { AuthService } from './auth.service';
import { CSRF_COOKIE, SESSION_COOKIE } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setCookies(res: Response, s: { raw: string; csrf: string; maxAgeMs: number }) {
    const base = {
      secure: this.env.cookieSecure,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: s.maxAgeMs,
    };
    res.cookie(SESSION_COOKIE, s.raw, { ...base, httpOnly: true });
    // Readable by the SPA so it can echo the value in X-CSRF-Token.
    res.cookie(CSRF_COOKIE, s.csrf, { ...base, httpOnly: false });
  }

  private clearCookies(res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
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
