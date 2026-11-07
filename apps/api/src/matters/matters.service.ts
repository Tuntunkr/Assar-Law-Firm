import { Inject, Injectable } from '@nestjs/common';
import {
  clients,
  matterAccess,
  matters,
  mongoose,
  parties,
  teams,
  type MatterDoc,
} from '@assar/database';
import type { z } from 'zod';
import type {
  createMatterSchema,
  createPartySchema,
  matterListQuerySchema,
  setMatterAccessSchema,
  updateMatterSchema,
  updatePartySchema,
} from '@assar/validation';
import type { JobQueues } from '@assar/jobs';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { assertActiveMembers } from '../common/members';
import { QUEUES } from '../queue/queue.module';
import { MatterAccessService } from './matter-access.service';

type Req = Pick<AppRequest, 'ip' | 'id'>;
type PartyRow = Awaited<ReturnType<typeof parties.create>>;

const idStr = (v: unknown) => (v == null ? null : String(v));

/** Only fields that are set; an all-empty court is reported as null. */
const courtDto = (c: MatterDoc['court']) => {
  if (!c) return null;
  const out = {
    name: c.name ?? null,
    caseNumber: c.caseNumber ?? null,
    judge: c.judge ?? null,
    courtroom: c.courtroom ?? null,
    jurisdiction: c.jurisdiction ?? null,
    filedOn: c.filedOn ?? null,
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
};

export const matterDto = (m: MatterDoc) => ({
  id: String(m._id),
  matterNumber: m.matterNumber,
  clientId: String(m.clientId),
  title: m.title,
  practiceArea: m.practiceArea,
  description: m.description ?? null,
  court: courtDto(m.court),
  status: m.status,
  restricted: m.restricted,
  portalVisible: !!m.portalVisible,
  portalNote: m.portalNote ?? null,
  leadAttorneyId: idStr(m.leadAttorneyId),
  teamIds: m.teamIds.map(String),
  openedAt: m.openedAt,
  closedAt: m.closedAt ?? null,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
});

export const partyDto = (p: PartyRow) => ({
  id: String(p._id),
  matterId: String(p.matterId),
  name: p.name,
  type: p.type,
  role: p.role,
  email: p.email ?? null,
  phone: p.phone ?? null,
});

@Injectable()
export class MattersService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
    @Inject(QUEUES) private readonly queues: JobQueues,
  ) {}

  private async assertTeams(orgId: string, teamIds: string[]) {
    const unique = [...new Set(teamIds)];
    if (unique.length && (await teams.countIn(orgId, unique)) !== unique.length) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'One or more teams do not exist');
    }
  }

  async create(auth: AuthContext, input: z.infer<typeof createMatterSchema>, req: Req) {
    const orgId = auth.organizationId;
    if (!(await clients.findById(orgId, input.clientId)))
      throw new ApiError(404, 'NOT_FOUND', 'Client not found');
    const accessIds = input.restricted
      ? [
          ...new Set([
            ...input.accessUserIds,
            auth.userId,
            ...(input.leadAttorneyId ? [input.leadAttorneyId] : []),
          ]),
        ]
      : [];
    await assertActiveMembers(orgId, [
      ...accessIds,
      ...(input.leadAttorneyId ? [input.leadAttorneyId] : []),
    ]);
    await this.assertTeams(orgId, input.teamIds);

    const tx = await mongoose.startSession();
    let matter!: Awaited<ReturnType<typeof matters.create>>;
    try {
      await tx.withTransaction(async () => {
        const matterNumber = await matters.nextNumber(orgId, { session: tx });
        matter = await matters.create(
          {
            organizationId: orgId as never,
            clientId: input.clientId as never,
            matterNumber,
            title: input.title,
            practiceArea: input.practiceArea,
            description: input.description,
            court: input.court ?? null,
            status: 'open',
            restricted: input.restricted,
            leadAttorneyId: (input.leadAttorneyId ?? null) as never,
            teamIds: input.teamIds as never,
            openedAt: new Date(),
            closedAt: null,
            createdBy: auth.userId as never,
          },
          { session: tx },
        );
        if (input.restricted)
          await matterAccess.replace(orgId, matter._id, accessIds, auth.userId, { session: tx });
      });
    } finally {
      await tx.endSession();
    }
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'matter.created',
      targetType: 'matter',
      targetId: String(matter._id),
      req,
      meta: { restricted: input.restricted, matterNumber: matter.matterNumber },
    });
    // Best effort: a workflow hiccup must never fail matter creation. Ids only, no matter content.
    await this.queues
      .publish({
        event: 'matter.created',
        organizationId: orgId,
        data: {
          matterId: String(matter._id),
          createdBy: auth.userId,
          restricted: input.restricted,
        },
      })
      .catch(() => undefined);
    return matterDto(matter);
  }

  async list(auth: AuthContext, q: z.infer<typeof matterListQuerySchema>) {
    const restrictedVisibleIds = await this.access.visibleRestrictedIds(auth);
    const page = await matters.listPage(auth.organizationId, { ...q, restrictedVisibleIds });
    return { data: page.data.map(matterDto), page: page.page };
  }

  async get(auth: AuthContext, id: string, req: Req) {
    const m = await this.access.load(auth, id, req);
    return { ...matterDto(m), canManageAccess: this.access.canManageAccess(auth, m) };
  }

  async update(auth: AuthContext, id: string, patch: z.infer<typeof updateMatterSchema>, req: Req) {
    const orgId = auth.organizationId;
    const current = await this.access.load(auth, id, req);
    if (patch.leadAttorneyId) await assertActiveMembers(orgId, [patch.leadAttorneyId]);
    if (patch.teamIds) await this.assertTeams(orgId, patch.teamIds);

    const set: Record<string, unknown> = { ...patch };
    if (patch.status && patch.status !== current.status) {
      set.closedAt = patch.status === 'closed' || patch.status === 'archived' ? new Date() : null;
    }
    const updated = await matters.update(orgId, id, set);
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Matter not found');
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'matter.updated',
      targetType: 'matter',
      targetId: id,
      req,
      meta: { fields: Object.keys(patch) },
    });
    return matterDto(updated);
  }

  // ---- access ----

  async getAccess(auth: AuthContext, id: string, req: Req) {
    const m = await this.access.load(auth, id, req);
    if (!this.access.canManageAccess(auth, m))
      throw new ApiError(403, 'FORBIDDEN', 'You cannot manage access to this matter');
    const userIds = (await matterAccess.userIdsFor(auth.organizationId, id)).map(String);
    return { restricted: m.restricted, userIds };
  }

  async setAccess(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof setMatterAccessSchema>,
    req: Req,
  ) {
    const orgId = auth.organizationId;
    const m = await this.access.load(auth, id, req);
    if (!this.access.canManageAccess(auth, m))
      throw new ApiError(403, 'FORBIDDEN', 'You cannot manage access to this matter');

    const before = (await matterAccess.userIdsFor(orgId, id)).map(String);
    // The actor and lead attorney stay on the list so a restriction can't strand the matter.
    const userIds = input.restricted
      ? [
          ...new Set([
            ...input.userIds,
            auth.userId,
            ...(m.leadAttorneyId ? [String(m.leadAttorneyId)] : []),
          ]),
        ]
      : [];
    await assertActiveMembers(orgId, userIds);

    const tx = await mongoose.startSession();
    try {
      await tx.withTransaction(async () => {
        await matters.update(orgId, id, { restricted: input.restricted }, { session: tx });
        await matterAccess.replace(orgId, id, userIds, auth.userId, { session: tx });
      });
    } finally {
      await tx.endSession();
    }
    await this.audit.record({
      organizationId: orgId,
      actorId: auth.userId,
      action: 'matter.access_changed',
      targetType: 'matter',
      targetId: id,
      req,
      meta: {
        wasRestricted: m.restricted,
        restricted: input.restricted,
        added: userIds.filter((u) => !before.includes(u)),
        removed: before.filter((u) => !userIds.includes(u)),
      },
    });
    return { restricted: input.restricted, userIds };
  }

  // ---- parties ----

  async listParties(auth: AuthContext, matterId: string, req: Req) {
    await this.access.load(auth, matterId, req);
    return { data: (await parties.listForMatter(auth.organizationId, matterId)).map(partyDto) };
  }

  async addParty(
    auth: AuthContext,
    matterId: string,
    input: z.infer<typeof createPartySchema>,
    req: Req,
  ) {
    await this.access.load(auth, matterId, req);
    const p = await parties.create(auth.organizationId, matterId, input);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'party.created',
      targetType: 'party',
      targetId: String(p._id),
      req,
      meta: { matterId, role: input.role },
    });
    return partyDto(p);
  }

  async updateParty(
    auth: AuthContext,
    matterId: string,
    partyId: string,
    patch: z.infer<typeof updatePartySchema>,
    req: Req,
  ) {
    await this.access.load(auth, matterId, req);
    const p = await parties.update(auth.organizationId, matterId, partyId, patch);
    if (!p) throw new ApiError(404, 'NOT_FOUND', 'Party not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'party.updated',
      targetType: 'party',
      targetId: partyId,
      req,
      meta: { matterId, fields: Object.keys(patch) },
    });
    return partyDto(p);
  }

  async removeParty(auth: AuthContext, matterId: string, partyId: string, req: Req) {
    await this.access.load(auth, matterId, req);
    const res = await parties.delete(auth.organizationId, matterId, partyId);
    if (res.deletedCount !== 1) throw new ApiError(404, 'NOT_FOUND', 'Party not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'party.deleted',
      targetType: 'party',
      targetId: partyId,
      req,
      meta: { matterId },
    });
  }
}
