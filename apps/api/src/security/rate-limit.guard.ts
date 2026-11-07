import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, type ThrottlerStorage } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AppRequest } from '../common/auth-context';
import { RATE_LIMIT_KEY, type RateLimitOptions } from '../common/decorators';
import { ENV, type Env } from '../config/env';

export const RATE_LIMIT_STORAGE = Symbol('RATE_LIMIT_STORAGE');

/**
 * Limits by WHO is calling, after authentication. The IP-based limiter (which runs first and covers sign-in
 * and anonymous traffic) is a poor fit for signed-in users: a whole office shares one address, and an attacker
 * with a stolen session can rotate addresses. This guard counts per user, per portal user and per service
 * token, plus optional tighter limits for expensive routes (`@RateLimit`).
 */
@Injectable()
export class PrincipalRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_STORAGE) private readonly storage: ThrottlerStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const principal = req.auth
      ? `u:${req.auth.userId}`
      : req.portalUser
        ? `c:${req.portalUser.clientUserId}`
        : req.service
          ? `s:${req.service.tokenId}`
          : null;
    if (!principal) return true; // anonymous routes are covered by the IP limiter

    const baseline = req.service
      ? this.env.SERVICE_RATE_LIMIT_PER_MIN
      : this.env.PRINCIPAL_RATE_LIMIT_PER_MIN;
    await this.hit(res, principal, req.service ? 'service' : 'principal', baseline, 60_000);

    const extra = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (extra) await this.hit(res, principal, extra.name, extra.limit, extra.windowSeconds * 1000);
    return true;
  }

  private async hit(
    res: Response,
    principal: string,
    name: string,
    limit: number,
    windowMs: number,
  ) {
    const r = await this.storage.increment(principal, windowMs, limit, 0, name);
    if (r.totalHits > limit) {
      res.setHeader('Retry-After', String(r.timeToExpire));
      throw new ThrottlerException();
    }
  }
}
