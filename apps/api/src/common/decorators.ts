import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@assar/types';
import type { AppRequest } from './auth-context';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_MFA_ENROLLMENT = 'allowMfaEnrollment';
export const PERMISSIONS_KEY = 'permissions';
export const IDEMPOTENT_KEY = 'idempotent';

/** Route needs no session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route stays reachable while MFA enrollment is still pending. */
export const AllowMfaEnrollment = () => SetMetadata(ALLOW_MFA_ENROLLMENT, true);
export const RequirePermissions = (...p: Permission[]) => SetMetadata(PERMISSIONS_KEY, p);
/** Requires an `Idempotency-Key` header; `redact` fields are not persisted in the replay record. */
export const Idempotent = (opts: { redact?: string[] } = {}) => SetMetadata(IDEMPOTENT_KEY, opts);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw new Error('Auth() used on a public route');
  return req.auth;
});
