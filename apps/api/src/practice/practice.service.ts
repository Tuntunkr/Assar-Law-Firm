import { Inject, Injectable } from '@nestjs/common';
import {
  clients,
  deadlines,
  dispatchPracticeReminders,
  localMailbox,
  outbox,
  type DeadlineDoc,
  type OutboxDoc,
} from '@assar/database';
import { decideDelivery } from '@assar/types';
import {
  buildTemplateBody,
  parseStatusWebhook,
  sendTemplate,
  signatureMatches,
  statusRank,
  whatsappConfig,
  type StatusEvent,
} from './whatsapp-cloud';
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
  templateName: m.templateName ?? null,
  templateLanguage: m.templateLanguage ?? null,
  body: m.body,
  providerTemplateApproval: 'not_claimed' as const,
  status: m.status,
  provider: m.provider,
  attempts: m.attempts,
  providerMessageId: m.providerMessageId ?? null,
  providerError: m.providerError ?? null,
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
      templateName: input.templateName ?? null,
      templateLanguage: input.templateLanguage ?? null,
      bodyParameters: input.bodyParameters ?? [],
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
    if (!approve) {
      const row = await outbox.update(auth.organizationId, id, {
        status: 'rejected',
        approvedBy: null,
        approvedAt: null,
      });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
      await this.audit.record({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'outbox.rejected',
        targetType: 'outbox',
        targetId: id,
        req,
        meta: { status: row.status, provider: row.provider },
      });
      return outboxDto(row);
    }
    await this.assertWhatsAppAllowed(auth.organizationId, current);
    if (current.channel === 'email' && this.env.EMAIL_DELIVERY !== 'off') {
      return this.deliverEmail(auth, current, req);
    }
    if (this.env.MESSAGE_PROVIDER === 'whatsapp_cloud' && current.channel === 'whatsapp') {
      return this.deliverWhatsApp(auth, current, req);
    }
    const delivery =
      this.env.MESSAGE_PROVIDER === 'mock'
        ? decideDelivery('mock')
        : decideDelivery('unconfigured');
    const row = await outbox.update(auth.organizationId, id, {
      status: delivery.status,
      provider: delivery.provider,
      attempts: delivery.status === 'mock_delivered' ? 1 : 0,
      approvedBy: auth.userId,
      approvedAt: new Date(),
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'outbox.approved',
      targetType: 'outbox',
      targetId: id,
      req,
      meta: { status: row.status, provider: row.provider },
    });
    return outboxDto(row);
  }

  /** Sends again only when the provider never accepted the message. A new preview is required after that. */
  async retryOutbox(auth: AuthContext, id: string, req: Req) {
    const current = await this.loadOutbox(auth, id, req);
    if (current.status !== 'failed' || current.provider !== 'whatsapp_cloud')
      throw new ApiError(409, 'CONFLICT', 'Only a failed WhatsApp send can be retried');
    if (current.providerMessageId)
      throw new ApiError(
        409,
        'CONFLICT',
        'The provider already accepted this message. Write a new preview instead of sending it again.',
      );
    await this.assertWhatsAppAllowed(auth.organizationId, current);
    return this.deliverWhatsApp(auth, current, req);
  }

  /**
   * Applies one documented status webhook. The same event key is a replay.
   * An earlier status does not replace a later one. A failure does not erase delivered or read.
   */
  async applyWhatsAppStatuses(raw: Buffer, header: string, body: unknown) {
    const cfg = whatsappConfig(this.env);
    if (!cfg)
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'External activation gate: WhatsApp credentials are not configured',
      );
    if (!signatureMatches(cfg.appSecret, raw, header))
      throw new ApiError(401, 'UNAUTHENTICATED', 'Webhook signature was rejected');
    const events = parseStatusWebhook(body);
    const results: { eventKey: string; replayed: boolean; status: string }[] = [];
    for (const event of events) {
      results.push(await this.applyOneStatus(cfg.phoneNumberId, event));
    }
    return { received: events.length, results };
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

  /** Local mailbox or a closed SMTP gate. This method does not open a network socket. */
  private async deliverEmail(auth: AuthContext, current: OutboxDoc, req: Req) {
    if (this.env.EMAIL_DELIVERY === 'smtp') {
      const row = await outbox.update(auth.organizationId, String(current._id), {
        status: 'external_activation_gate',
        provider: 'smtp',
        providerError: 'smtp_send_not_enabled',
        attempts: 0,
        approvedBy: auth.userId,
        approvedAt: new Date(),
      });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
      await this.audit.record({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'outbox.approved',
        targetType: 'outbox',
        targetId: String(current._id),
        req,
        meta: { status: row.status, provider: row.provider },
      });
      return outboxDto(row);
    }
    const client = await clients.findById(auth.organizationId, String(current.clientId));
    if (!client?.email)
      throw new ApiError(400, 'VALIDATION_FAILED', 'The client needs an email address before a local copy can be kept.');
    const existing = await localMailbox.findByOutbox(auth.organizationId, String(current._id));
    if (!existing) {
      await localMailbox.create({
        organizationId: auth.organizationId,
        outboxId: String(current._id),
        to: client.email,
        subject: current.templateLabel,
        body: current.body,
      });
    }
    const row = await outbox.update(auth.organizationId, String(current._id), {
      status: 'held_local',
      provider: 'local_mailbox',
      attempts: 1,
      providerError: null,
      approvedBy: auth.userId,
      approvedAt: new Date(),
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'outbox.approved',
      targetType: 'outbox',
      targetId: String(current._id),
      req,
      meta: { status: row.status, provider: row.provider },
    });
    return outboxDto(row);
  }

  private async assertWhatsAppAllowed(organizationId: string, row: OutboxDoc) {
    if (row.channel !== 'whatsapp') return;
    const client = await clients.findById(organizationId, String(row.clientId));
    if (client?.whatsappOptOutAt)
      throw new ApiError(409, 'CONFLICT', 'This client has opted out of WhatsApp');
  }

  private async deliverWhatsApp(auth: AuthContext, current: OutboxDoc, req: Req) {
    const cfg = whatsappConfig(this.env);
    if (!cfg) {
      const row = await outbox.update(auth.organizationId, String(current._id), {
        status: 'external_activation_gate',
        provider: 'whatsapp_cloud',
        providerError: 'missing_credentials',
        attempts: 0,
        approvedBy: auth.userId,
        approvedAt: new Date(),
      });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
      await this.audit.record({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'outbox.approved',
        targetType: 'outbox',
        targetId: String(current._id),
        req,
        meta: { status: row.status, provider: row.provider },
      });
      return outboxDto(row);
    }
    const client = await clients.findById(auth.organizationId, String(current.clientId));
    const built = buildTemplateBody({
      to: client?.phone ?? '',
      templateName: current.templateName ?? '',
      languageCode: current.templateLanguage ?? '',
      bodyParameters: current.bodyParameters ?? [],
      outboxId: String(current._id),
    });
    if (!built.ok) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        built.error === 'recipient_not_e164'
          ? 'The client phone needs a plus and a country code. This software does not add one.'
          : 'A WhatsApp template name and language are required. Saving them does not mean Meta has approved the template.',
      );
    }
    if (current.providerMessageId) {
      return outboxDto(current);
    }
    const sent = await sendTemplate(cfg, built.body, globalThis.fetch);
    const row = await outbox.update(auth.organizationId, String(current._id), {
      status: sent.ok ? 'accepted' : 'failed',
      provider: 'whatsapp_cloud',
      attempts: sent.attempts,
      ...(sent.ok ? { providerMessageId: sent.messageId } : {}),
      providerError: sent.ok ? null : sent.error,
      approvedBy: current.approvedBy ?? auth.userId,
      approvedAt: current.approvedAt ?? new Date(),
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: sent.ok ? 'outbox.accepted' : 'outbox.failed',
      targetType: 'outbox',
      targetId: String(current._id),
      req,
      meta: { status: row.status, provider: row.provider, attempts: sent.attempts },
    });
    return outboxDto(row);
  }

  private async applyOneStatus(phoneNumberId: string, event: StatusEvent) {
    const row = await outbox.findByProviderMessageId(event.messageId);
    if (!row) return { eventKey: event.eventKey, replayed: false, status: 'ignored' };
    if (event.phoneNumberId && event.phoneNumberId !== phoneNumberId) {
      return { eventKey: event.eventKey, replayed: false, status: 'ignored' };
    }
    if (row.webhookEventIds.includes(event.eventKey)) {
      return { eventKey: event.eventKey, replayed: true, status: row.status };
    }
    const current = statusRank(row.status);
    const incoming = statusRank(event.status);
    const keep =
      event.status === 'failed' ? current >= statusRank('delivered') : incoming < current;
    const next = keep ? row.status : event.status;
    const updated = await outbox.update(String(row.organizationId), String(row._id), {
      $set: {
        status: next,
        providerError:
          event.status === 'failed' && !keep
            ? `meta_${event.errorCode ?? 'unknown'}`
            : (row.providerError ?? null),
      },
      $addToSet: { webhookEventIds: event.eventKey },
    });
    await this.audit.record({
      organizationId: String(row.organizationId),
      actorType: 'system',
      action: 'outbox.webhook',
      targetType: 'outbox',
      targetId: String(row._id),
      meta: { status: next, replayed: false },
    });
    return {
      eventKey: event.eventKey,
      replayed: false,
      status: updated?.status ?? next,
    };
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
