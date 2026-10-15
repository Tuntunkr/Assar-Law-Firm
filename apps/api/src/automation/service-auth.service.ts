import { Injectable } from '@nestjs/common';
import { serviceTokens } from '@assar/database';
import type { ServiceScope } from '@assar/types';
import type { ServiceContext } from '../common/auth-context';
import { sha256 } from '../common/crypto';
import { ApiError } from '../common/exception.filter';

export const SERVICE_TOKEN_PREFIX = 'ast_';

@Injectable()
export class ServiceAuthService {
  /**
   * Validates `Authorization: Bearer ast_...`. Failures are all reported as the same 401 so a caller
   * learns nothing about whether a token exists, is revoked, expired or merely lacks the scope.
   */
  async authenticate(header: string | undefined, required: ServiceScope): Promise<ServiceContext> {
    const fail = () => new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    const m = /^Bearer (ast_[\w-]{20,200})$/.exec(header ?? '');
    if (!m) throw fail();
    const token = await serviceTokens.findByHash(sha256(m[1]!));
    if (!token || token.status !== 'active') throw fail();
    if (token.expiresAt && token.expiresAt <= new Date()) throw fail();
    if (!token.scopes.includes(required)) throw fail();
    // Record use at most once a minute.
    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000)
      void serviceTokens.touch(token._id).catch(() => undefined);
    return {
      tokenId: String(token._id),
      organizationId: String(token.organizationId),
      name: token.name,
      scopes: token.scopes as ServiceScope[],
    };
  }
}
