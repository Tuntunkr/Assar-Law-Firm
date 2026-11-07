import { Inject, Injectable } from '@nestjs/common';
import {
  clients,
  deadlines,
  dispatchPracticeReminders,
  outbox,
  type DeadlineDoc,
  type OutboxDoc,
} from '@assar/database';
import { decideDelivery } from '@assar/types';
import type { z } from 'zod';
import type {
  createDeadlineSchema,
  outboxDraftSchema,
  updateDeadlineSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { ENV, type Env } from '../config/env';
import { MatterAccessService } from '../matters/matter-access.service';

type Req = Pick<AppRequest, 'ip' | 'id'>;

const deadlineDto = (d: DeadlineDoc) => ({
  id: String(d._id),
  matterId: String(d.matterId),
  kind: d.kind,
  title: d.title,
  basisNote: d.basisNote,
  dueOn: d.dueOn,
  timezone: 'Asia/Kolkata' as const,
  reminderDaysBefore: d.reminderDaysBefore,
  escalateAfterDays: d.escalateAfterDays,
  status: d.status,
  history: d.history.map((h) => ({
    at: h.at,
    actorId: String(h.actorId),
    action: h.action,
  })),
  statutoryCalculation: 'not_performed' as const,
  approvedAt: d.approvedAt ?? null,
});

const outboxDto = (m: OutboxDoc) => ({
  id: String(m._id),
  clientId: String(m.clientId),
  matterId: m.matterId ? String(m.matterId) : null,
  channel: m.channel,
  templateLabel: m.templateLabel,
  body: m.body,
  providerTemplateApproval: 'not_claimed' as const,
  status: m.status,
  provider: m.provider,
  attempts: m.attempts,
  approvedAt: m.approvedAt ?? null,
});

@Injectable()
export class PracticeService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  provider() {
    return {
      id: 'none',
      status: 'external_activation_gate' as const,
      lookup: 'not_performed' as const,
      detail:
        'No official court feed is connected. A CNR is checked for shape only. A person can record that they compared an entry with an official source. This server does not call a court and does not invent orders or dates.',
    };
  }

  async listDeadlines(auth: AuthContext) {
    const hidden = await this.access.hiddenMatterIds(auth);
    const rows = await deadlines.list(auth.organizationId, hidden);
    return { data: rows.map(deadlineDto) };
  }

  async createDeadline(auth: AuthContext, input: z.infer<typeof createDeadlineSchema>, req: Req) {
    await this.access.load(auth, input.matterId, req);
    const row = await deadlines.create({
      organizationId: auth.organizationId as never,
      matterId: input.matterId as never,
      kind: input.kind,
      title: input.title,
      basisNote: input.basisNote,
      dueOn: input.dueOn,
      reminderDaysBefore: input.reminderDaysBefore,
      escalateAfterDays: input.escalateAfterDays,
      createdBy: auth.userId as never,
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'deadline.drafted',
      targetType: 'deadline',
      targetId: String(row._id),
      req,
      meta: { kind: input.kind },
    });
    return deadlineDto(row);
  }

  async updateDeadline(
    auth: AuthContext,
    id: string,
    patch: z.infer<typeof updateDeadlineSchema>,
    req: Req,
  ) {
    const current = await this.loadDeadline(auth, id, req);
    if (current.status !== 'draft' && current.status !== 'rejected')
      throw new ApiError(409, 'CONFLICT', 'Only a draft or rejected date can be edited');
    const row = await deadlines.update(auth.organizationId, id, {
      ...patch,
      status: 'draft',
      $push: { history: { at: new Date(), actorId: auth.userId, action: 'edited' } },
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Date not found');
    return deadlineDto(row);
  }

  async transition(
    auth: AuthContext,
    id: string,
    action: 'submit' | 'approve' | 'reject' | 'close',
    req: Req,
  ) {
    const current = await this.loadDeadline(auth, id, req);
    const next =
      action === 'submit'
        ? 'pending_approval'
        : action === 'approve'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : 'closed';
    if (action === 'submit' && current.status !== 'draft' && current.status !== 'rejected')
      throw new ApiError(409, 'CONFLICT', 'This date is not waiting to be submitted');
    if ((action === 'approve' || action === 'reject') && current.status !== 'pending_approval')
      throw new ApiError(409, 'CONFLICT', 'This date is not waiting for a lawyer');
    const row = await deadlines.update(auth.organizationId, id, {
      status: next,
      ...(action === 'approve' ? { approvedBy: auth.userId, approvedAt: new Date() } : {}),
      $push: { history: { at: new Date(), actorId: auth.userId, action } },
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Date not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: `deadline.${action}`,
      targetType: 'deadline',
      targetId: id,
      req,
    });
    return deadlineDto(row);
  }

  async runReminders(auth: AuthContext, req: Req) {
    const result = await dispatchPracticeReminders();
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'deadline.reminders_run',
      req,
      meta: result,
    });
    return result;
  }

  async listOutbox(auth: AuthContext) {
    const hidden = await this.access.hiddenMatterIds(auth);
    const rows = await outbox.list(auth.organizationId, hidden);
    return { data: rows.map(outboxDto) };
  }

  async draftOutbox(auth: AuthContext, input: z.infer<typeof outboxDraftSchema>, req: Req) {
    if (!(await clients.findById(auth.organizationId, input.clientId)))
      throw new ApiError(404, 'NOT_FOUND', 'Client not found');
    if (input.matterId) await this.access.load(auth, input.matterId, req);
    const row = await outbox.create({
      organizationId: auth.organizationId as never,
      clientId: input.clientId as never,
      matterId: (input.matterId ?? null) as never,
      channel: input.channel,
      templateLabel: input.templateLabel,
      body: input.body,
      providerTemplateApproval: 'not_claimed',
      consent: {
        optedIn: true,
        namesFirm: true,
        note: input.consent.note ?? null,
        recordedBy: auth.userId as never,
        recordedAt: new Date(),
      },
      status: 'pending_approval',
      provider: 'unconfigured',
      approvedBy: null,
      approvedAt: null,
      createdBy: auth.userId as never,
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'outbox.drafted',
      targetType: 'outbox',
      targetId: String(row._id),
      req,
      meta: { channel: input.channel },
    });
    return outboxDto(row);
  }

  async decideOutbox(auth: AuthContext, id: string, approve: boolean, req: Req) {
    const current = await this.loadOutbox(auth, id, req);
    if (current.status !== 'pending_approval')
      throw new ApiError(409, 'CONFLICT', 'This preview is not waiting for a lawyer');
    if (!current.consent?.optedIn || !current.consent?.namesFirm)
      throw new ApiError(409, 'CONFLICT', 'Record an opt-in that names the firm before approval');
    const delivery = approve ? decideDelivery(this.env.MESSAGE_PROVIDER) : null;
    const row = await outbox.update(auth.organizationId, id, {
      status: approve ? delivery!.status : 'rejected',
      provider: approve ? delivery!.provider : current.provider,
      attempts: approve && delivery!.status === 'mock_delivered' ? 1 : 0,
      approvedBy: approve ? auth.userId : null,
      approvedAt: approve ? new Date() : null,
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: approve ? 'outbox.approved' : 'outbox.rejected',
      targetType: 'outbox',
      targetId: id,
      req,
      meta: { status: row.status, provider: row.provider },
    });
    return outboxDto(row);
  }

  /**
   * Records a mock provider acknowledgement. Never promotes a gated preview to sent.
   * The caller has already checked the signature.
   */
  async ackMock(organizationId: string, outboxId: string, eventId: string) {
    const row = await outbox.findById(organizationId, outboxId);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
    if (row.webhookEventIds.includes(eventId)) return { replayed: true, status: row.status };
    if (row.status !== 'mock_delivered')
      throw new ApiError(409, 'CONFLICT', 'Only a mock delivery can be acknowledged');
    await outbox.update(organizationId, outboxId, { $addToSet: { webhookEventIds: eventId } });
    return { replayed: false, status: row.status };
  }

  private async loadDeadline(auth: AuthContext, id: string, req: Req) {
    const row = await deadlines.findById(auth.organizationId, id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Date not found');
    await this.access.load(auth, String(row.matterId), req);
    return row;
  }

  private async loadOutbox(auth: AuthContext, id: string, req: Req) {
    const row = await outbox.findById(auth.organizationId, id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
    if (row.matterId) await this.access.load(auth, String(row.matterId), req);
    return row;
  }
}
