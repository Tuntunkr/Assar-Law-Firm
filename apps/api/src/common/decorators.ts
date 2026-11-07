import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission, ServiceScope } from '@assar/types';
import type { AppRequest } from './auth-context';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_MFA_ENROLLMENT = 'allowMfaEnrollment';
export const PERMISSIONS_KEY = 'permissions';
export const IDEMPOTENT_KEY = 'idempotent';
export const CLIENT_PORTAL = 'clientPortal';
export const SERVICE_SCOPE = 'serviceScope';
export const RATE_LIMIT_KEY = 'rateLimit';

/** Route needs no session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route stays reachable while MFA enrollment is still pending. */
export const AllowMfaEnrollment = () => SetMetadata(ALLOW_MFA_ENROLLMENT, true);
export const RequirePermissions = (...p: Permission[]) => SetMetadata(PERMISSIONS_KEY, p);
/** Requires an `Idempotency-Key` header (unless `optional`: then keyless requests simply run normally); `redact` fields are not persisted in the replay record. */
export const Idempotent = (opts: { redact?: string[]; optional?: boolean } = {}) =>
  SetMetadata(IDEMPOTENT_KEY, opts);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw new Error('Auth() used on a public route');
  return req.auth;
});

/** Route group for portal clients: authenticated with the portal cookie only (never staff sessions). */
export const ClientPortal = () => SetMetadata(CLIENT_PORTAL, true);
/** Route callable only by an automation service token holding `scope` (never by cookies). */
export const ServiceAccess = (scope: ServiceScope) => SetMetadata(SERVICE_SCOPE, scope);

export const Client = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.portalUser) throw new Error('Client() used outside a portal route');
  return req.portalUser;
});
export const Service = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.service) throw new Error('Service() used outside an automation route');
  return req.service;
});

export interface RateLimitOptions {
  /** Counter name; routes sharing a name share a budget. */
  name: string;
  limit: number;
  windowSeconds: number;
}
/** A tighter per-caller limit for an expensive route, on top of the baseline per-caller limit. */
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, opts);
