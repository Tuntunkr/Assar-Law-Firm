import { Injectable } from '@nestjs/common';
import {
  matterAccess,
  matterIds,
  matterVisibility,
  matters,
  memberships,
  type MatterDoc,
} from '@assar/database';
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
    if (auth.role === 'intern') {
      if (!(await matterAccess.has(auth.organizationId, id, auth.userId)))
        throw new ApiError(404, 'NOT_FOUND', 'Matter not found');
      await this.audit.record({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        actorType: 'staff',
        action: 'intern.matter_opened',
        targetType: 'matter',
        targetId: id,
        req,
      });
      return matter;
    }
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

  /**
   * Restricted matters the caller can NOT see. Used to filter org-wide lists (calendar, tasks):
   * items on these matters are excluded, items with no matter are kept.
   */
  async hiddenMatterIds(auth: AuthContext): Promise<string[]> {
    if (auth.role === 'intern') {
      const all = (await matterIds.all(auth.organizationId)).map(String);
      const mine = new Set(
        (await matterAccess.matterIdsFor(auth.organizationId, auth.userId)).map(String),
      );
      return all.filter((id) => !mine.has(id));
    }
    if (auth.role === 'owner') return [];
    const restricted = await matterVisibility.restrictedIds(auth.organizationId);
    if (restricted.length === 0) return [];
    const mine = new Set(
      (await matterAccess.matterIdsFor(auth.organizationId, auth.userId)).map(String),
    );
    return restricted.map(String).filter((id) => !mine.has(id));
  }

  /**
   * Like `load`, but a hidden matter is reported with the caller-supplied message ("Document not found",
   * "Task not found", ...). This keeps a hidden item indistinguishable from one that doesn't exist.
   */
  async loadFor(
    auth: AuthContext,
    matterId: string | null | undefined,
    req: Req,
    notFoundMessage: string,
  ): Promise<MatterRow | null> {
    try {
      return await this.loadOptional(auth, matterId, req);
    } catch (e) {
      if (e instanceof ApiError && e.getStatus() === 404)
        throw new ApiError(404, 'NOT_FOUND', notFoundMessage);
      throw e;
    }
  }

  /** `load` for an optional matter reference (tasks/events may be org-level). */
  async loadOptional(
    auth: AuthContext,
    matterId: string | null | undefined,
    req: Req,
  ): Promise<MatterRow | null> {
    return matterId ? this.load(auth, matterId, req) : null;
  }

  /**
   * Rejects assigning/inviting a user who couldn't themselves see a restricted matter, so
   * assignment can't be used to leak or bypass the access list.
   */
  async assertUserCanSee(organizationId: string, matter: MatterRow, userId: string): Promise<void> {
    if (!matter.restricted) return;
    if (await matterAccess.has(organizationId, matter._id, userId)) return;
    const m = await memberships.find(organizationId, userId);
    if (m?.role === 'owner') return;
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'A selected user does not have access to this restricted matter',
    );
  }
}
