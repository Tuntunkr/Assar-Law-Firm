import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type Permission, type ServiceScope } from '@assar/types';
import type { AppRequest } from '../common/auth-context';
import { safeEqual } from '../common/crypto';
import {
  ALLOW_MFA_ENROLLMENT,
  CLIENT_PORTAL,
  IS_PUBLIC,
  PERMISSIONS_KEY,
  SERVICE_SCOPE,
} from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import { ENV, type Env } from '../config/env';
import { ServiceAuthService } from '../automation/service-auth.service';
import { ClientSessionService, PORTAL_SESSION_COOKIE } from '../portal/client-session.service';
import { SESSION_COOKIE, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Three mutually exclusive ways in, chosen by the route, never by what the caller presents:
 *  - `@ServiceAccess(scope)` routes accept only an automation Bearer token;
 *  - `@ClientPortal()` routes accept only the portal session cookie;
 *  - everything else accepts only the staff session cookie.
 * So a client session can't call staff routes (or vice versa), and a service token can't call anything
 * outside the automation endpoints its scopes allow.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly clientSessions: ClientSessionService,
    private readonly serviceAuth: ServiceAuthService,
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

    const scope = this.reflector.getAllAndOverride<ServiceScope | undefined>(
      SERVICE_SCOPE,
      targets,
    );
    if (scope) {
      req.service = await this.serviceAuth.authenticate(req.header('authorization'), scope);
      return true;
    }

    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;

    if (this.reflector.getAllAndOverride<boolean>(CLIENT_PORTAL, targets)) {
      const raw = cookies[PORTAL_SESSION_COOKIE];
      const client = raw ? await this.clientSessions.validate(raw) : null;
      if (!client) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
      req.client = client;
      if (unsafe) {
        const header = req.header('x-csrf-token');
        if (!header || !safeEqual(header, client.csrfToken))
          throw new ApiError(403, 'FORBIDDEN', 'Missing or invalid CSRF token');
      }
      return true;
    }

    const raw = cookies[SESSION_COOKIE];
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
