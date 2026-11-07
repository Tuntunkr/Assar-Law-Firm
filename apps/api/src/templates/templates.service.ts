import { Injectable } from '@nestjs/common';
import { PartyModel, clients, draftTemplates, organizations, users } from '@assar/database';
import {
  BUILTIN_PLACEHOLDERS,
  extractPlaceholders,
  renderTemplate,
  type TemplateCategory,
} from '@assar/types';
import type { z } from 'zod';
import type {
  createTemplateSchema,
  renderTemplateSchema,
  templateListQuerySchema,
  updateTemplateSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { MatterAccessService } from '../matters/matter-access.service';
import { STARTER_TEMPLATES } from './starters';

type Req = Pick<AppRequest, 'ip' | 'id'>;
type Row = NonNullable<Awaited<ReturnType<typeof draftTemplates.findById>>>;
const isDuplicate = (e: unknown) => (e as { code?: number })?.code === 11000;
const long = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const summary = (t: Omit<Row, 'body'>) => ({
  id: String(t._id),
  name: t.name,
  category: t.category,
  description: t.description ?? null,
  placeholders: t.placeholders,
  status: t.status,
  starter: !!t.starterKey,
  revision: t.revision,
  updatedAt: t.updatedAt,
});
const dto = (t: Row) => ({ ...summary(t), body: t.body });

@Injectable()
export class TemplatesService {
  constructor(
    private readonly access: MatterAccessService,
    private readonly audit: AuditService,
  ) {}

  /** A new firm starts with the shipped templates; after that they are the firm's own. */
  private async ensureStarters(auth: AuthContext) {
    if ((await draftTemplates.count(auth.organizationId)) > 0) return;
    for (const s of STARTER_TEMPLATES)
      await draftTemplates.seed(auth.organizationId, auth.userId, {
        name: s.name,
        category: s.category,
        description: s.description,
        body: s.body,
        starterKey: s.key,
      });
  }

  async list(auth: AuthContext, q: z.infer<typeof templateListQuerySchema>) {
    await this.ensureStarters(auth);
    const rows = await draftTemplates.list(auth.organizationId, q);
    return { data: rows.map(summary) };
  }

  async get(auth: AuthContext, id: string) {
    const t = await draftTemplates.findById(auth.organizationId, id);
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Template not found');
    return dto(t);
  }

  async create(auth: AuthContext, input: z.infer<typeof createTemplateSchema>, req: Req) {
    try {
      const t = await draftTemplates.create(auth.organizationId, auth.userId, {
        name: input.name,
        category: input.category,
        description: input.description ?? null,
        body: input.body,
      });
      await this.audit.record({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'template.created',
        targetType: 'template',
        targetId: String(t._id),
        req,
      });
      return dto(t);
    } catch (e) {
      if (isDuplicate(e))
        throw new ApiError(409, 'CONFLICT', 'A template with this name already exists');
      throw e;
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    patch: z.infer<typeof updateTemplateSchema>,
    req: Req,
  ) {
    try {
      const t = await draftTemplates.update(auth.organizationId, id, auth.userId, patch);
      if (!t) throw new ApiError(404, 'NOT_FOUND', 'Template not found');
      await this.audit.record({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: patch.status === 'archived' ? 'template.archived' : 'template.updated',
        targetType: 'template',
        targetId: id,
        req,
        meta: { fields: Object.keys(patch) },
      });
      return dto(t);
    } catch (e) {
      if (isDuplicate(e))
        throw new ApiError(409, 'CONFLICT', 'A template with this name already exists');
      throw e;
    }
  }

  /**
   * Fills a template. Facts come from the matter (which the caller must be allowed to see), the client,
   * the firm and the caller; anything else is taken from `values`. Whatever stays unknown is marked.
   */
  async render(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof renderTemplateSchema>,
    req: Req,
  ) {
    const t = await draftTemplates.findById(auth.organizationId, id);
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Template not found');
    const facts = new Map<string, string>();
    const put = (k: string, v: unknown) => {
      if (v != null && String(v).trim() !== '') facts.set(k, String(v));
    };

    const [org, author] = await Promise.all([
      organizations.findById(auth.organizationId),
      users.findById(auth.userId),
    ]);
    put('today', long.format(new Date()));
    put('firm.name', org?.name);
    put('author.name', author?.name);

    if (input.matterId) {
      const m = await this.access.load(auth, input.matterId, req); // 404s for hidden matters
      const [client, lead, parties] = await Promise.all([
        clients.findById(auth.organizationId, String(m.clientId)),
        m.leadAttorneyId ? users.findById(String(m.leadAttorneyId)) : null,
        PartyModel.find({
          organizationId: auth.organizationId as never,
          matterId: input.matterId as never,
        })
          .sort({ createdAt: 1 })
          .select('name role')
          .lean(),
      ]);
      put('matter.title', m.title);
      put('matter.number', m.matterNumber);
      put('matter.practice_area', m.practiceArea.replace(/_/g, ' '));
      put('matter.description', m.description);
      put('matter.opened_on', long.format(m.openedAt));
      put('attorney.name', lead?.name);
      put('client.name', client?.name);
      put('client.type', client?.type);
      put('client.email', client?.email);
      put('client.phone', client?.phone);
      put('client.address', client?.address);
      put('court.name', m.court?.name);
      put('court.case_number', m.court?.caseNumber);
      put('court.judge', m.court?.judge);
      put('court.courtroom', m.court?.courtroom);
      put('court.jurisdiction', m.court?.jurisdiction);
      put(
        'court.filed_on',
        m.court?.filedOn ? long.format(new Date(`${m.court.filedOn}T00:00:00Z`)) : null,
      );
      put('party.opposing.name', parties.find((p) => p.role === 'opposing_party')?.name);
      put('party.opposing_counsel.name', parties.find((p) => p.role === 'opposing_counsel')?.name);
    }

    // What the person typed wins over what the system found.
    for (const [k, v] of Object.entries(input.values)) if (v.trim() !== '') facts.set(k, v);

    const { text, missing } = renderTemplate(t.body, (k) => facts.get(k));
    const labels = new Map<string, string>(BUILTIN_PLACEHOLDERS.map((p) => [p.key, p.label]));
    const keys = extractPlaceholders(t.body);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'template.rendered',
      targetType: 'template',
      targetId: id,
      req,
      meta: { matterId: input.matterId ?? null, missing: missing.length }, // never the filled-in values
    });
    return {
      text,
      missing,
      placeholders: keys.map((key) => ({
        key,
        label: labels.get(key) ?? null,
        builtin: labels.has(key),
        value: facts.get(key) ?? null,
        missing: missing.includes(key),
      })),
    };
  }
}

export type { TemplateCategory };
