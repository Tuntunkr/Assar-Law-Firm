import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  courtForms,
  courtImports,
  demoBookings,
  localMailbox,
  matters,
  type CourtImportDoc,
} from '@assar/database';
import type { z } from 'zod';
import type {
  applyCourtImportSchema,
  courtFormDraftSchema,
  courtFormSignoffSchema,
  courtImportBatchSchema,
  demoBookingSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { ENV, type Env } from '../config/env';
import { MatterAccessService } from '../matters/matter-access.service';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const STALE_MS = 7 * 24 * 3600_000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

const canon = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const hashPayload = (row: Record<string, unknown>) =>
  createHash('sha256').update(canon(row)).digest('hex');

const importDto = (row: CourtImportDoc) => ({
  id: String(row._id),
  sourceName: row.sourceName,
  externalId: row.externalId,
  courtName: row.courtName,
  caseNumber: row.caseNumber,
  title: row.title,
  listedOn: row.listedOn,
  sourceUrl: row.sourceUrl,
  retrievedAt: row.retrievedAt,
  status: row.status,
  error: row.error,
  appliedToMatter: !!row.appliedToMatterId,
  appliedToMatterId: row.appliedToMatterId ? String(row.appliedToMatterId) : null,
  appliedAt: row.appliedAt ?? null,
});

@Injectable()
export class ActivationService {
  constructor(
    private readonly audit: AuditService,
    private readonly access: MatterAccessService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  courtFeed() {
    return {
      mode: this.env.COURT_FEED,
      lookup: 'not_performed' as const,
      liveProvider: 'none' as const,
      detail:
        this.env.COURT_FEED === 'import'
          ? 'Authorised file-drop import is on. Staff may store rows the firm already obtained and apply one to a matter after review. This server does not call a court and does not scrape.'
          : 'No court feed is connected. Court fields stay manual. Set COURT_FEED=import for authorised file-drop rows.',
    };
  }

  async listImports(auth: AuthContext) {
    if (this.env.COURT_FEED !== 'import')
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Court import is off. COURT_FEED=manual.');
    const rows = await courtImports.list(auth.organizationId);
    return { mode: 'import' as const, data: rows.map(importDto) };
  }

  async importCauseList(
    auth: AuthContext,
    body: z.infer<typeof courtImportBatchSchema>,
    req: Req,
  ) {
    if (this.env.COURT_FEED !== 'import')
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Court import is off. Set COURT_FEED=import to store a file the firm already obtained. This server still will not call a court.',
      );
    const results = [];
    for (const row of body.rows) {
      const retrievedAt = new Date(row.retrievedAt);
      const payloadHash = hashPayload({
        externalId: row.externalId,
        courtName: row.courtName,
        caseNumber: row.caseNumber,
        title: row.title,
        listedOn: row.listedOn,
        sourceName: row.sourceName,
        sourceUrl: row.sourceUrl,
      });
      const stale = Date.now() - retrievedAt.getTime() > STALE_MS;
      const existing = await courtImports.findKey(auth.organizationId, row.sourceName, row.externalId);
      if (!existing) {
        const created = await courtImports.insert({
          organizationId: auth.organizationId as never,
          sourceName: row.sourceName,
          externalId: row.externalId,
          payloadHash,
          courtName: row.courtName,
          caseNumber: row.caseNumber,
          title: row.title,
          listedOn: row.listedOn,
          sourceUrl: row.sourceUrl,
          retrievedAt,
          status: stale ? 'stale' : 'stored',
          error: stale ? 'retrievedAt is older than 7 days' : null,
          importedBy: auth.userId as never,
        });
        results.push({ externalId: row.externalId, outcome: stale ? 'stale' : 'stored', id: String(created._id) });
        continue;
      }
      if (existing.payloadHash === payloadHash) {
        results.push({ externalId: row.externalId, outcome: 'replayed', id: String(existing._id) });
        continue;
      }
      if (existing.status === 'stored' && !row.retry) {
        results.push({ externalId: row.externalId, outcome: 'conflict', id: String(existing._id) });
        continue;
      }
      if (stale && existing.retrievedAt > retrievedAt) {
        results.push({ externalId: row.externalId, outcome: 'stale_ignored', id: String(existing._id) });
        continue;
      }
      const replaced = await courtImports.replace(auth.organizationId, row.sourceName, row.externalId, {
        payloadHash,
        courtName: row.courtName,
        caseNumber: row.caseNumber,
        title: row.title,
        listedOn: row.listedOn,
        sourceUrl: row.sourceUrl,
        retrievedAt,
        status: stale ? 'stale' : 'stored',
        error: stale ? 'retrievedAt is older than 7 days' : null,
        importedBy: auth.userId as never,
      });
      results.push({
        externalId: row.externalId,
        outcome: stale ? 'stale' : 'replaced',
        id: String(replaced?._id ?? existing._id),
      });
    }
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'court.import',
      targetType: 'court_import',
      targetId: auth.organizationId,
      req,
      meta: { rows: results.length },
    });
    return { appliedToMatter: false as const, results };
  }

  /**
   * Copies an imported row onto a matter after a person reviews it.
   * Does not fetch a court. Freshness stays unverified until someone records a comparison.
   */
  async applyImport(
    auth: AuthContext,
    id: string,
    body: z.infer<typeof applyCourtImportSchema>,
    req: Req,
  ) {
    if (this.env.COURT_FEED !== 'import')
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Court import is off. COURT_FEED=manual.');
    const row = await courtImports.findById(auth.organizationId, id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Import row not found');
    if (row.status !== 'stored')
      throw new ApiError(
        409,
        'CONFLICT',
        'Only a fresh stored import can be applied. Stale or error rows stay off the matter.',
      );
    const matter = await this.access.load(auth, body.matterId, req);
    const at = new Date();
    const updated = await matters.update(auth.organizationId, body.matterId, {
      court: {
        ...(matter.court ?? {}),
        name: row.courtName,
        caseNumber: row.caseNumber,
        officialUrl: row.sourceUrl,
        trackingSource: 'import',
        freshness: 'unverified',
        verifiedAt: null,
        verifiedBy: null,
      },
    });
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Matter not found');
    const marked = await courtImports.markApplied(auth.organizationId, id, {
      matterId: body.matterId,
      actorId: auth.userId,
      at,
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'court.import_applied',
      targetType: 'matter',
      targetId: body.matterId,
      req,
      meta: {
        importId: id,
        externalId: row.externalId,
        sourceName: row.sourceName,
        note: body.note ?? null,
        listedOn: row.listedOn,
        title: row.title,
      },
    });
    return {
      import: importDto(marked ?? { ...row, appliedToMatterId: body.matterId as never, appliedAt: at, appliedBy: auth.userId as never }),
      matterId: body.matterId,
      trackingSource: 'import' as const,
      freshness: 'unverified' as const,
      lookup: 'not_performed' as const,
    };
  }

  async slots() {
    this.requireLocalBooking();
    const now = Date.now();
    const start = new Date(now + IST_OFFSET_MS);
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth();
    const d = start.getUTCDate();
    const from = new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
    const to = new Date(from.getTime() + 21 * 24 * 3600_000);
    const taken = new Set((await demoBookings.taken(from, to)).map((r) => r.slotStart.toISOString()));
    const slots: string[] = [];
    for (let i = 0; i < 21 && slots.length < 10; i++) {
      const day = new Date(Date.UTC(y, m, d + i));
      const weekday = day.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      for (const hour of [10, 15]) {
        const slot = new Date(Date.UTC(y, m, d + i, hour - 5, 30));
        if (slot.getTime() <= now) continue;
        if (taken.has(slot.toISOString())) continue;
        slots.push(slot.toISOString());
        if (slots.length === 10) break;
      }
    }
    return { timezone: 'Asia/Kolkata' as const, notification: 'not_sent' as const, slots };
  }

  async book(input: z.infer<typeof demoBookingSchema>) {
    this.requireLocalBooking();
    const slotStart = new Date(input.slotStart);
    if (Number.isNaN(slotStart.getTime()) || slotStart.getTime() <= Date.now())
      throw new ApiError(400, 'VALIDATION_FAILED', 'Choose a slot that has not already started.');
    const offered = (await this.slots()).slots;
    if (!offered.includes(slotStart.toISOString()))
      throw new ApiError(409, 'CONFLICT', 'That slot is not open. Refresh the list and choose another.');
    try {
      const row = await demoBookings.create({
        name: input.name,
        email: input.email,
        firm: input.firm,
        firmSize: input.firmSize,
        message: input.message ?? null,
        slotStart,
      });
      return {
        id: String(row._id),
        status: 'recorded_local' as const,
        notification: 'not_sent' as const,
        slotStart: row.slotStart,
      };
    } catch (err) {
      if ((err as { code?: number }).code === 11000)
        throw new ApiError(409, 'CONFLICT', 'That slot was just taken. Choose another.');
      throw err;
    }
  }

  async listForms(auth: AuthContext) {
    const rows = await courtForms.list(auth.organizationId);
    return { data: rows.map(formDto) };
  }

  async createForm(auth: AuthContext, input: z.infer<typeof courtFormDraftSchema>, req: Req) {
    const row = await courtForms.create({
      organizationId: auth.organizationId as never,
      title: input.title,
      jurisdiction: input.jurisdiction,
      caseType: input.caseType,
      body: input.body,
      officialSourceTitle: input.officialSourceTitle,
      officialSourceUrl: input.officialSourceUrl,
      sourceRetrievedOn: input.sourceRetrievedOn,
      createdBy: auth.userId as never,
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'court_form.drafted',
      targetType: 'court_form',
      targetId: String(row._id),
      req,
    });
    return formDto(row);
  }

  async signForm(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof courtFormSignoffSchema>,
    req: Req,
  ) {
    const row = await courtForms.decide(auth.organizationId, id, {
      status: input.decision,
      advocateDeclaration: true,
      signoffNote: input.note,
      decidedBy: auth.userId as never,
      decidedAt: new Date(),
    });
    if (!row) throw new ApiError(409, 'CONFLICT', 'Only a draft can be signed. This is not a license check.');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'court_form.signed',
      targetType: 'court_form',
      targetId: id,
      req,
      meta: { status: row.status, licenseCheck: 'not_performed' },
    });
    return formDto(row);
  }

  async listMailbox(auth: AuthContext) {
    if (this.env.EMAIL_DELIVERY !== 'local')
      return { mode: this.env.EMAIL_DELIVERY, data: [] as const };
    const rows = await localMailbox.list(auth.organizationId);
    return {
      mode: 'local' as const,
      data: rows.map((r) => ({
        id: String(r._id),
        outboxId: String(r.outboxId),
        to: r.to,
        subject: r.subject,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  }

  private requireLocalBooking() {
    if (this.env.DEMO_BOOKING !== 'local')
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Demo booking is not configured. Nothing was stored and no notification was sent.',
      );
  }
}

const formDto = (row: {
  _id: unknown;
  title: string;
  jurisdiction: string;
  caseType: string;
  body: string;
  officialSourceTitle: string;
  officialSourceUrl: string;
  sourceRetrievedOn: string;
  version: number;
  status: string;
  advocateDeclaration: boolean;
  signoffNote?: string | null;
  licenseCheck: 'not_performed';
}) => ({
  id: String(row._id),
  title: row.title,
  jurisdiction: row.jurisdiction,
  caseType: row.caseType,
  body: row.body,
  officialSourceTitle: row.officialSourceTitle,
  officialSourceUrl: row.officialSourceUrl,
  sourceRetrievedOn: row.sourceRetrievedOn,
  version: row.version,
  status: row.status,
  advocateDeclaration: row.advocateDeclaration,
  signoffNote: row.signoffNote ?? null,
  licenseCheck: row.licenseCheck,
});
