import { Injectable } from '@nestjs/common';
import { MatterModel, UserModel, billingReports, clients as clientRepo } from '@assar/database';
import type { z } from 'zod';
import type { reportRangeSchema, timeReportQuerySchema } from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { MatterAccessService } from '../matters/matter-access.service';
import { csvRow } from './csv';

type Req = Pick<AppRequest, 'ip' | 'id'>;
const MAX_EXPORT_ROWS = 50_000;
const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

@Injectable()
export class ReportsService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
  ) {}

  /** Names for ids, so reports are readable. Only ids that survived the visibility filter are looked up. */
  private async labels(orgId: string, kind: 'user' | 'matter' | 'client', ids: string[]) {
    if (ids.length === 0) return new Map<string, string>();
    if (kind === 'user')
      return new Map(
        (
          await UserModel.find({ _id: { $in: ids } })
            .select('name')
            .lean()
        ).map((u) => [String(u._id), u.name]),
      );
    if (kind === 'matter')
      return new Map(
        (
          await MatterModel.find({ organizationId: orgId, _id: { $in: ids } })
            .select('matterNumber title')
            .lean()
        ).map((m) => [String(m._id), `${m.matterNumber} ${m.title}`]),
      );
    return new Map(
      (await Promise.all(ids.map((id) => clientRepo.findById(orgId, id))))
        .filter((c) => !!c)
        .map((c) => [String(c!._id), c!.name]),
    );
  }

  async time(auth: AuthContext, q: z.infer<typeof timeReportQuerySchema>) {
    const hiddenMatterIds = await this.access.hiddenMatterIds(auth);
    const rows = await billingReports.time(auth.organizationId, {
      from: q.from,
      to: q.to,
      groupBy: q.groupBy,
      userId: q.userId,
      hiddenMatterIds,
    });
    const labels = await this.labels(
      auth.organizationId,
      q.groupBy,
      rows.map((r) => String(r._id)),
    );
    return {
      from: q.from.toISOString().slice(0, 10),
      to: q.to.toISOString().slice(0, 10),
      groupBy: q.groupBy,
      /** Time on restricted matters you cannot see is not counted. */
      restrictedMattersExcluded: hiddenMatterIds.length > 0,
      rows: rows.map((r) => ({
        key: String(r._id),
        label: labels.get(String(r._id)) ?? null,
        entries: r.entries,
        hours: hours(r.minutes),
        billableHours: hours(r.billableMinutes),
        billableAmountCents: r.billableAmountCents,
        unbilledAmountCents: r.unbilledAmountCents,
      })),
    };
  }

  async summary(auth: AuthContext, q: z.infer<typeof reportRangeSchema>) {
    const hiddenMatterIds = await this.access.hiddenMatterIds(auth);
    const s = await billingReports.summary(auth.organizationId, {
      from: q.from,
      to: q.to,
      now: new Date(),
      hiddenMatterIds,
    });
    return {
      from: q.from.toISOString().slice(0, 10),
      to: q.to.toISOString().slice(0, 10),
      restrictedMattersExcluded: hiddenMatterIds.length > 0,
      ...s,
      unbilledHours: hours(s.unbilledMinutes),
    };
  }

  /** Receivables by how late they are, as of now. */
  async aging(auth: AuthContext) {
    const hiddenMatterIds = await this.access.hiddenMatterIds(auth);
    const open = await billingReports.openInvoices(auth.organizationId, hiddenMatterIds);
    const now = Date.now();
    const buckets = {
      notYetDue: { count: 0, cents: 0 },
      days1to30: { count: 0, cents: 0 },
      days31to60: { count: 0, cents: 0 },
      days61to90: { count: 0, cents: 0 },
      over90: { count: 0, cents: 0 },
    };
    for (const i of open) {
      const late = i.dueAt ? Math.floor((now - i.dueAt.getTime()) / 86_400_000) : 0;
      const b =
        late <= 0
          ? buckets.notYetDue
          : late <= 30
            ? buckets.days1to30
            : late <= 60
              ? buckets.days31to60
              : late <= 90
                ? buckets.days61to90
                : buckets.over90;
      b.count += 1;
      b.cents += i.balanceCents;
    }
    return {
      asOf: new Date(now),
      restrictedMattersExcluded: hiddenMatterIds.length > 0,
      buckets,
      totalCents: open.reduce((s, i) => s + i.balanceCents, 0),
    };
  }

  async exportTimeCsv(auth: AuthContext, q: z.infer<typeof timeReportQuerySchema>, req: Req) {
    const hiddenMatterIds = await this.access.hiddenMatterIds(auth);
    const rows = await billingReports.exportTime(
      auth.organizationId,
      { from: q.from, to: q.to, userId: q.userId, hiddenMatterIds },
      MAX_EXPORT_ROWS + 1,
    );
    if (rows.length > MAX_EXPORT_ROWS)
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        `Too many rows (over ${MAX_EXPORT_ROWS}). Narrow the date range.`,
      );
    const [users, mattersMap] = await Promise.all([
      this.labels(auth.organizationId, 'user', [...new Set(rows.map((r) => String(r.userId)))]),
      this.labels(auth.organizationId, 'matter', [...new Set(rows.map((r) => String(r.matterId)))]),
    ]);
    const lines = [
      csvRow([
        'Date',
        'Person',
        'Matter',
        'Hours',
        'Billable',
        'Rate',
        'Amount',
        'Currency',
        'Status',
        'Description',
      ]),
    ];
    const money = (c: number) => (c / 100).toFixed(2);
    for (const r of rows) {
      lines.push(
        csvRow([
          r.workDate.toISOString().slice(0, 10),
          users.get(String(r.userId)) ?? '',
          mattersMap.get(String(r.matterId)) ?? '',
          (r.minutes / 60).toFixed(2),
          r.billable ? 'yes' : 'no',
          money(r.rateCents),
          money(r.amountCents),
          r.currency,
          r.status,
          r.description,
        ]),
      );
    }
    // Who exported how much, never what: descriptions are confidential.
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'report.time_exported',
      req,
      meta: {
        from: q.from.toISOString().slice(0, 10),
        to: q.to.toISOString().slice(0, 10),
        rows: rows.length,
      },
    });
    return {
      filename: `time-${q.from.toISOString().slice(0, 10)}-to-${q.to.toISOString().slice(0, 10)}.csv`,
      body: `﻿${lines.join('\r\n')}\r\n`,
    };
  }
}
