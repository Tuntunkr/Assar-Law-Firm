import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type Permission } from '@assar/types';
import type { AppRequest } from '../common/auth-context';
import { safeEqual } from '../common/crypto';
import { ALLOW_MFA_ENROLLMENT, IS_PUBLIC, PERMISSIONS_KEY } from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import { ENV, type Env } from '../config/env';
import { SESSION_COOKIE, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const unsafe = !SAFE_METHODS.has(req.method);

    // Defence in depth for cookie auth: a browser-supplied Origin must be one we trust.
    const origin = req.header('origin');
    if (
      unsafe &&
      origin &&
      this.env.CORS_ORIGINS.length > 0 &&
      !this.env.CORS_ORIGINS.includes(origin)
    ) {
      throw new ApiError(403, 'FORBIDDEN', 'Origin not allowed');
    }

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const raw = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const auth = raw ? await this.sessions.validate(raw) : null;
    if (!auth) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    req.auth = auth;

    if (unsafe) {
      const header = req.header('x-csrf-token');
      if (!header || !safeEqual(header, auth.csrfToken)) {
        throw new ApiError(403, 'FORBIDDEN', 'Missing or invalid CSRF token');
      }
    }

    if (
      auth.mfaEnrollmentRequired &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_ENROLLMENT, targets)
    ) {
      throw new ApiError(
        403,
        'MFA_ENROLLMENT_REQUIRED',
        'Set up multi-factor authentication to continue',
      );
    }
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const auth = ctx.switchToHttp().getRequest<AppRequest>().auth;
    if (!auth || !required.every((p) => hasPermission(auth.role, p))) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
