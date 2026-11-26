import { Injectable } from '@nestjs/common';
import { calendar, type CalendarEventDoc } from '@assar/database';
import { hasPermission } from '@assar/types';
import type { z } from 'zod';
import type {
  createEventSchema,
  eventListQuerySchema,
  hearingOutcomeSchema,
  updateEventSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { assertActiveMembers } from '../common/members';
import { MatterAccessService } from '../matters/matter-access.service';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const idStr = (v: unknown) => (v == null ? null : String(v));

export const eventDto = (e: CalendarEventDoc) => ({
  id: String(e._id),
  matterId: idStr(e.matterId),
  kind: e.kind,
  title: e.title,
  description: e.description ?? null,
  startsAt: e.startsAt,
  endsAt: e.endsAt ?? null,
  allDay: e.allDay,
  location: e.location ?? null,
  attendeeIds: e.attendeeIds.map(String),
  status: e.status,
  source: e.source,
  outcome: e.outcome
    ? {
        result: e.outcome.result,
        notes: e.outcome.notes,
        nextHearingOn: e.outcome.nextHearingOn ?? null,
        reviewStatus: e.outcome.reviewStatus,
        recordedAt: e.outcome.recordedAt,
        reviewedAt: e.outcome.reviewedAt ?? null,
      }
    : null,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

@Injectable()
export class CalendarService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
  ) {}

  /** Attendees must be active members and, for restricted matters, able to see the matter. */
  private async checkAttendees(
    orgId: string,
    matter: Awaited<ReturnType<MatterAccessService['loadOptional']>>,
    ids: string[],
  ) {
    await assertActiveMembers(orgId, ids);
    if (matter)
      for (const id of new Set(ids)) await this.access.assertUserCanSee(orgId, matter, id);
  }

  /** Loads an event the caller may see; events on hidden matters are indistinguishable from missing. */
  private async load(auth: AuthContext, id: string, req: Req) {
    const e = await calendar.findById(auth.organizationId, id);
    if (!e) throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    const matter = await this.access.loadFor(auth, idStr(e.matterId), req, 'Event not found');
    return { event: e, matter };
  }

  async create(auth: AuthContext, input: z.infer<typeof createEventSchema>, req: Req) {
    const matter = await this.access.loadOptional(auth, input.matterId, req);
    await this.checkAttendees(auth.organizationId, matter, input.attendeeIds);
    const e = await calendar.create({
      organizationId: auth.organizationId as never,
      matterId: (input.matterId ?? null) as never,
      kind: input.kind,
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      allDay: input.allDay,
      location: input.location,
      attendeeIds: input.attendeeIds as never,
      status: 'scheduled',
      createdBy: auth.userId as never,
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'event.created',
      targetType: 'event',
      targetId: String(e._id),
      req,
      meta: { kind: e.kind, matterId: idStr(e.matterId) },
    });
    return eventDto(e);
  }

  async list(auth: AuthContext, q: z.infer<typeof eventListQuerySchema>, req: Req) {
    if (q.matterId) await this.access.load(auth, q.matterId, req);
    const hiddenMatterIds = q.matterId ? [] : await this.access.hiddenMatterIds(auth);
    const page = await calendar.listRange(auth.organizationId, { ...q, hiddenMatterIds });
    return { data: page.data.map(eventDto), page: page.page };
  }

  async get(auth: AuthContext, id: string, req: Req) {
    return eventDto((await this.load(auth, id, req)).event);
  }

  async update(auth: AuthContext, id: string, patch: z.infer<typeof updateEventSchema>, req: Req) {
    const { event, matter } = await this.load(auth, id, req);
    const targetMatter =
      patch.matterId !== undefined
        ? await this.access.loadOptional(auth, patch.matterId, req)
        : matter;
    if (patch.matterId !== undefined || patch.attendeeIds) {
      await this.checkAttendees(
        auth.organizationId,
        targetMatter,
        patch.attendeeIds ?? event.attendeeIds.map(String),
      );
    }
    const startsAt = patch.startsAt ?? event.startsAt;
    const endsAt = patch.endsAt === undefined ? event.endsAt : patch.endsAt;
    if (endsAt && endsAt < startsAt)
      throw new ApiError(400, 'VALIDATION_FAILED', 'endsAt must not be before startsAt');

    const updated = await calendar.update(auth.organizationId, id, patch);
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'event.updated',
      targetType: 'event',
      targetId: id,
      req,
      meta: { fields: Object.keys(patch) },
    });
    return eventDto(updated);
  }

  async remove(auth: AuthContext, id: string, req: Req) {
    await this.load(auth, id, req);
    await calendar.delete(auth.organizationId, id);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'event.deleted',
      targetType: 'event',
      targetId: id,
      req,
    });
  }

  async recordOutcome(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof hearingOutcomeSchema>,
    req: Req,
    review: boolean,
  ) {
    const { event } = await this.load(auth, id, req);
    if (event.kind !== 'hearing')
      throw new ApiError(409, 'CONFLICT', 'Only a hearing can have an outcome');
    if (review && !hasPermission(auth.role, 'hearing:review'))
      throw new ApiError(403, 'FORBIDDEN', 'A lawyer has to review a hearing outcome');
    const now = new Date();
    const outcome = review
      ? {
          ...(event.outcome ?? {}),
          result: event.outcome?.result,
          notes: event.outcome?.notes,
          nextHearingOn: event.outcome?.nextHearingOn ?? null,
          reviewStatus: 'reviewed' as const,
          recordedBy: event.outcome?.recordedBy ?? auth.userId,
          recordedAt: event.outcome?.recordedAt ?? now,
          reviewedBy: auth.userId,
          reviewedAt: now,
        }
      : {
          result: input.result,
          notes: input.notes,
          nextHearingOn: input.nextHearingOn ?? null,
          reviewStatus: 'draft' as const,
          recordedBy: auth.userId,
          recordedAt: now,
          reviewedBy: null,
          reviewedAt: null,
        };
    if (review && !event.outcome)
      throw new ApiError(409, 'CONFLICT', 'Record the outcome before it is reviewed');
    const updated = await calendar.update(auth.organizationId, id, { outcome });
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: review ? 'hearing.reviewed' : 'hearing.outcome_recorded',
      targetType: 'event',
      targetId: id,
      req,
      meta: { reviewStatus: outcome.reviewStatus },
    });
    return eventDto(updated);
  }

  /** Copies a reviewed next date into a new manual hearing. Does not calculate a limitation. */
  async scheduleNext(auth: AuthContext, id: string, req: Req) {
    if (!hasPermission(auth.role, 'hearing:review'))
      throw new ApiError(403, 'FORBIDDEN', 'A lawyer has to schedule the next hearing');
    const { event } = await this.load(auth, id, req);
    const next = event.outcome?.nextHearingOn;
    if (event.outcome?.reviewStatus !== 'reviewed' || !next)
      throw new ApiError(409, 'CONFLICT', 'Review the outcome and set a next date first');
    const startsAt = new Date(`${next}T04:30:00.000Z`);
    const created = await calendar.create({
      organizationId: auth.organizationId as never,
      matterId: (event.matterId ?? null) as never,
      kind: 'hearing',
      title: `Next hearing: ${event.title}`.slice(0, 200),
      description: 'Created from a reviewed hearing note. The date was typed, not calculated.',
      startsAt,
      endsAt: null,
      allDay: true,
      attendeeIds: [],
      status: 'scheduled',
      createdBy: auth.userId as never,
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'hearing.next_scheduled',
      targetType: 'event',
      targetId: String(created._id),
      req,
      meta: { fromEventId: id },
    });
    return eventDto(created);
  }
}
