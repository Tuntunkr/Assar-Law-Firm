import { Injectable } from '@nestjs/common';
import { audit } from '@assar/database';
import type { AppRequest } from '../common/auth-context';

export interface AuditInput {
  organizationId: string;
  actorId?: string | null;
  /** Defaults to `staff` when an actor is given, `system` otherwise. */
  actorType?: 'staff' | 'client' | 'service' | 'system';
  action: string;
  targetType?: string;
  targetId?: string;
  req?: Pick<AppRequest, 'ip' | 'id'>;
  /** Metadata only — never document contents, passwords or tokens. */
  meta?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  async record(i: AuditInput) {
    await audit.record({
      organizationId: i.organizationId as never,
      actorId: (i.actorId ?? null) as never,
      actorType: i.actorType ?? (i.actorId ? 'staff' : 'system'),
      action: i.action,
      targetType: i.targetType,
      targetId: i.targetId,
      ip: i.req?.ip,
      requestId: i.req?.id,
      meta: i.meta,
    });
  }
}
