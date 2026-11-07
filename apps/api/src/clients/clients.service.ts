import { Injectable } from '@nestjs/common';
import { clients } from '@assar/database';
import type { z } from 'zod';
import type {
  clientListQuerySchema,
  createClientSchema,
  updateClientSchema,
  whatsappOptOutSchema,
} from '@assar/validation';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';

type Req = Pick<AppRequest, 'ip' | 'id'>;
type ClientRow = NonNullable<Awaited<ReturnType<typeof clients.findById>>>;

export const clientDto = (c: ClientRow) => ({
  id: String(c._id),
  type: c.type,
  name: c.name,
  email: c.email ?? null,
  phone: c.phone ?? null,
  address: c.address ?? null,
  whatsappOptOutAt: c.whatsappOptOutAt ?? null,
  status: c.status,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

@Injectable()
export class ClientsService {
  constructor(private readonly audit: AuditService) {}

  async create(auth: AuthContext, input: z.infer<typeof createClientSchema>, req: Req) {
    const c = await clients.create(auth.organizationId, auth.userId, input);
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'client.created',
      targetType: 'client',
      targetId: String(c._id),
      req,
    });
    return clientDto(c);
  }

  async list(auth: AuthContext, q: z.infer<typeof clientListQuerySchema>) {
    const page = await clients.listPage(auth.organizationId, q);
    return { data: page.data.map(clientDto), page: page.page };
  }

  async get(auth: AuthContext, id: string) {
    const c = await clients.findById(auth.organizationId, id);
    if (!c) throw new ApiError(404, 'NOT_FOUND', 'Client not found');
    return clientDto(c);
  }

  async update(auth: AuthContext, id: string, patch: z.infer<typeof updateClientSchema>, req: Req) {
    const c = await clients.update(auth.organizationId, id, patch);
    if (!c) throw new ApiError(404, 'NOT_FOUND', 'Client not found');
    // Field names only — never values (they may be personal data).
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'client.updated',
      targetType: 'client',
      targetId: id,
      req,
      meta: { fields: Object.keys(patch) },
    });
    return clientDto(c);
  }

  async setWhatsAppOptOut(
    auth: AuthContext,
    id: string,
    input: z.infer<typeof whatsappOptOutSchema>,
    req: Req,
  ) {
    const existing = await clients.findById(auth.organizationId, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Client not found');
    const c = await clients.update(auth.organizationId, id, {
      whatsappOptOutAt: input.optedOut ? new Date() : null,
    });
    if (!c) throw new ApiError(404, 'NOT_FOUND', 'Client not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'client.whatsapp_opt_out',
      targetType: 'client',
      targetId: id,
      req,
      meta: { optedOut: input.optedOut },
    });
    return clientDto(c);
  }
}
