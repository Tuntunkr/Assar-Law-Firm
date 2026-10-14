import { Injectable } from '@nestjs/common';
import { matterAccess, matters, type MatterDoc } from '@assar/database';
import { hasPermission } from '@assar/types';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';

type Req = Pick<AppRequest, 'ip' | 'id'>;
type MatterRow = Omit<MatterDoc, never>;

/**
 * Single place that decides who can see a matter.
 *
 *  - Unrestricted matter: every member whose role grants `matter:read` (checked by the route).
 *  - Restricted matter: only users on its access list. The organization owner has audited
 *    "break-glass" access so a firm can never lock itself out. Admins get NO implicit access.
 *  - A matter the caller can't see is reported as 404, never 403, so its existence isn't revealed.
 */
@Injectable()
export class MatterAccessService {
  constructor(private readonly audit: AuditService) {}

  /** Loads a matter the caller may access, or throws 404. */
  async load(auth: AuthContext, id: string, req: Req): Promise<MatterRow> {
    const matter = await matters.findById(auth.organizationId, id);
    if (!matter) throw new ApiError(404, 'NOT_FOUND', 'Matter not found');
    if (!matter.restricted) return matter;

    if (await matterAccess.has(auth.organizationId, id, auth.userId)) return matter;
    if (auth.role === 'owner') {
      await this.audit.record({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'matter.restricted_accessed_by_owner',
        targetType: 'matter',
        targetId: id,
        req,
      });
      return matter;
    }
    throw new ApiError(404, 'NOT_FOUND', 'Matter not found');
  }

  /** Restricted matter ids the caller can see, or 'all' for the owner. */
  async visibleRestrictedIds(auth: AuthContext) {
    if (auth.role === 'owner') return 'all' as const;
    return matterAccess.matterIdsFor(auth.organizationId, auth.userId);
  }

  /** Whether the caller may change who can see this matter. */
  canManageAccess(auth: AuthContext, matter: MatterRow): boolean {
    return (
      hasPermission(auth.role, 'user:manage') || String(matter.leadAttorneyId ?? '') === auth.userId
    );
  }
}
