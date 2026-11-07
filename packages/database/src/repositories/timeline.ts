import {
  AiOutputModel,
  CalendarEventModel,
  DocumentModel,
  DocumentVersionModel,
  InvoiceModel,
  MatterModel,
  PartyModel,
  TaskModel,
} from '../models/index.js';

type Id = string | { toString(): string };

export interface TimelineEntry {
  at: Date;
  type: string;
  title: string;
  detail: string | null;
  actorId: string | null;
  matterId: string | null;
  ref: { type: string; id: string } | null;
}

const PER_SOURCE = 200;
const s = (v: unknown) => (v == null ? null : String(v));

/**
 * What happened on a set of matters, newest first. Built from the records themselves (not from the audit
 * log) so it needs no extra bookkeeping and never contains more than the underlying records do. Callers must
 * already have removed matters the viewer cannot see.
 */
export const timeline = {
  async forMatters(
    organizationId: Id,
    matterIds: Id[],
    o: { limit: number; before?: Date; hiddenMatterIds?: Id[] },
  ): Promise<TimelineEntry[]> {
    if (matterIds.length === 0) return [];
    const org = organizationId as never;
    const ids = matterIds as never[];
    const before = o.before ?? new Date(8.64e15);
    const within = (field: string) => ({ [field]: { $lt: before } });

    const [matters, docs, versions, tasks, events, outputs, invoices, parties] = await Promise.all([
      MatterModel.find({ organizationId: org, _id: { $in: ids } })
        .select('title matterNumber openedAt closedAt createdBy status')
        .lean(),
      DocumentModel.find({
        organizationId: org,
        matterId: { $in: ids },
        status: 'active',
        ...within('createdAt'),
      })
        .sort({ createdAt: -1 })
        .limit(PER_SOURCE)
        .select('title matterId createdBy createdAt')
        .lean(),
      DocumentVersionModel.find({
        organizationId: org,
        matterId: { $in: ids },
        version: { $gt: 1 },
        ...within('createdAt'),
      })
        .sort({ createdAt: -1 })
        .limit(PER_SOURCE)
        .select('documentId matterId version filename uploadedBy createdAt')
        .lean(),
      TaskModel.find({ organizationId: org, matterId: { $in: ids } })
        .sort({ createdAt: -1 })
        .limit(PER_SOURCE)
        .select('title matterId createdBy createdAt completedAt status assigneeId')
        .lean(),
      CalendarEventModel.find({
        organizationId: org,
        matterId: { $in: ids },
        status: { $ne: 'cancelled' },
        startsAt: { $lt: new Date() },
      })
        .sort({ startsAt: -1 })
        .limit(PER_SOURCE)
        .select('title kind matterId startsAt status createdBy')
        .lean(),
      AiOutputModel.find({
        organizationId: org,
        matterId: { $in: ids },
        reviewStatus: { $in: ['approved', 'rejected'] },
      })
        .sort({ reviewedAt: -1 })
        .limit(PER_SOURCE)
        .select('task matterId reviewStatus reviewedAt reviewedBy')
        .lean(),
      InvoiceModel.find({
        organizationId: org,
        status: { $in: ['issued', 'paid', 'void'] },
        // An invoice that touches any matter the viewer cannot see is invisible to them.
        matterIds: {
          $in: ids,
          ...(o.hiddenMatterIds?.length ? { $nin: o.hiddenMatterIds as never[] } : {}),
        },
      })
        .sort({ issuedAt: -1 })
        .limit(PER_SOURCE)
        .select(
          'number clientId matterIds status totalCents currency issuedAt paidAt voidedAt createdBy',
        )
        .lean(),
      PartyModel.find({ organizationId: org, matterId: { $in: ids }, ...within('createdAt') })
        .sort({ createdAt: -1 })
        .limit(PER_SOURCE)
        .select('name role matterId createdAt')
        .lean(),
    ]);

    const out: TimelineEntry[] = [];
    const push = (
      e: Omit<TimelineEntry, 'detail' | 'actorId' | 'matterId' | 'ref'> & Partial<TimelineEntry>,
    ) => out.push({ detail: null, actorId: null, matterId: null, ref: null, ...e });
    const titleOf = new Map(matters.map((m) => [String(m._id), m.matterNumber]));

    for (const m of matters) {
      push({
        at: m.openedAt,
        type: 'matter.opened',
        title: 'Matter opened',
        detail: `${m.matterNumber} — ${m.title}`,
        actorId: s(m.createdBy),
        matterId: s(m._id),
        ref: { type: 'matter', id: String(m._id) },
      });
      if (m.closedAt)
        push({
          at: m.closedAt,
          type: 'matter.closed',
          title: `Matter ${m.status}`,
          detail: m.matterNumber,
          matterId: s(m._id),
          ref: { type: 'matter', id: String(m._id) },
        });
    }
    for (const d of docs)
      push({
        at: d.createdAt,
        type: 'document.added',
        title: 'Document added',
        detail: d.title,
        actorId: s(d.createdBy),
        matterId: s(d.matterId),
        ref: { type: 'document', id: String(d._id) },
      });
    for (const v of versions)
      push({
        at: v.createdAt,
        type: 'document.version',
        title: `New document version (v${v.version})`,
        detail: v.filename,
        actorId: s(v.uploadedBy),
        matterId: s(v.matterId),
        ref: { type: 'document', id: String(v.documentId) },
      });
    for (const t of tasks) {
      push({
        at: t.createdAt,
        type: 'task.created',
        title: 'Task created',
        detail: t.title,
        actorId: s(t.createdBy),
        matterId: s(t.matterId),
        ref: { type: 'task', id: String(t._id) },
      });
      if (t.completedAt)
        push({
          at: t.completedAt,
          type: 'task.completed',
          title: 'Task completed',
          detail: t.title,
          actorId: s(t.assigneeId),
          matterId: s(t.matterId),
          ref: { type: 'task', id: String(t._id) },
        });
    }
    for (const e of events)
      push({
        at: e.startsAt,
        type: `event.${e.kind}`,
        title: e.kind === 'hearing' ? 'Hearing' : e.kind === 'deadline' ? 'Deadline' : 'Event',
        detail: e.title,
        matterId: s(e.matterId),
        ref: { type: 'event', id: String(e._id) },
      });
    for (const a of outputs)
      push({
        at: a.reviewedAt ?? new Date(0),
        type: `ai.${a.reviewStatus}`,
        title: `AI ${a.task.replace(/_/g, ' ')} ${a.reviewStatus}`,
        actorId: s(a.reviewedBy),
        matterId: s(a.matterId),
        ref: { type: 'ai_output', id: String(a._id) },
      });
    for (const i of invoices) {
      const m = i.matterIds?.[0] ? (titleOf.get(String(i.matterIds[0])) ?? null) : null;
      const money = `${(i.totalCents / 100).toFixed(2)} ${i.currency}`;
      if (i.issuedAt)
        push({
          at: i.issuedAt,
          type: 'invoice.issued',
          title: 'Invoice issued',
          detail: `${i.number ?? ''} · ${money}`.trim(),
          actorId: s(i.createdBy),
          matterId: s(i.matterIds?.[0]),
          ref: { type: 'invoice', id: String(i._id) },
        });
      if (i.paidAt)
        push({
          at: i.paidAt,
          type: 'invoice.paid',
          title: 'Invoice paid',
          detail: `${i.number ?? ''} · ${money}`.trim(),
          matterId: s(i.matterIds?.[0]),
          ref: { type: 'invoice', id: String(i._id) },
        });
      void m;
    }
    for (const p of parties)
      push({
        at: p.createdAt,
        type: 'party.added',
        title: 'Party added',
        detail: `${p.name} (${p.role.replace(/_/g, ' ')})`,
        matterId: s(p.matterId),
      });

    return out
      .filter((e) => e.at < before)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, o.limit);
  },
};
