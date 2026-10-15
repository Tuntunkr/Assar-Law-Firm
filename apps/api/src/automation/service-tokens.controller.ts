import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { serviceTokens } from '@assar/database';
import { SERVICE_SCOPES } from '@assar/types';
import { createServiceTokenSchema } from '@assar/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { randomToken, sha256 } from '../common/crypto';
import { Auth, RequirePermissions } from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { SERVICE_TOKEN_PREFIX } from './service-auth.service';

const dto = (t: {
  _id: unknown;
  name: string;
  prefix: string;
  scopes: string[];
  status: string;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  createdAt: Date;
}) => ({
  id: String(t._id),
  name: t.name,
  prefix: t.prefix,
  scopes: t.scopes,
  status: t.status,
  expiresAt: t.expiresAt ?? null,
  lastUsedAt: t.lastUsedAt ?? null,
  createdAt: t.createdAt,
});

/** Manage the credentials n8n uses. Only roles with `workflow:manage` (owner, admin; both require MFA). */
@RequirePermissions('workflow:manage')
@Controller('service-tokens')
export class ServiceTokensController {
  constructor(private readonly audit: AuditService) {}

  @Get('scopes')
  scopes() {
    return { scopes: SERVICE_SCOPES };
  }

  @Post()
  async create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createServiceTokenSchema)) body: z.infer<typeof createServiceTokenSchema>,
    @Req() req: AppRequest,
  ) {
    const token = `${SERVICE_TOKEN_PREFIX}${randomToken(32)}`;
    const created = await serviceTokens.create({
      organizationId: auth.organizationId,
      name: body.name,
      prefix: token.slice(0, 8),
      tokenHash: sha256(token),
      scopes: [...new Set(body.scopes)],
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
      createdBy: auth.userId,
    });
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'service_token.created',
      targetType: 'service_token',
      targetId: String(created._id),
      req,
      meta: { scopes: created.scopes },
    });
    // The secret is shown once and only its hash is stored.
    return { ...dto(created), token };
  }

  @Get()
  async list(@Auth() auth: AuthContext) {
    return { data: (await serviceTokens.list(auth.organizationId)).map(dto) };
  }

  @HttpCode(204)
  @Delete(':id')
  async revoke(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    const t = await serviceTokens.revoke(auth.organizationId, id);
    if (!t) throw new ApiError(404, 'NOT_FOUND', 'Token not found');
    await this.audit.record({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'service_token.revoked',
      targetType: 'service_token',
      targetId: id,
      req,
    });
  }
}
