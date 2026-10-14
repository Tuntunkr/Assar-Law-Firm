import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { clientListQuerySchema, createClientSchema, updateClientSchema } from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Idempotent, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { ClientsService } from './clients.service';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @RequirePermissions('client:write')
  @Idempotent({ optional: true })
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createClientSchema)) body: z.infer<typeof createClientSchema>,
    @Req() req: AppRequest,
  ) {
    return this.clients.create(auth, body, req);
  }

  @RequirePermissions('client:read')
  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(clientListQuerySchema)) q: z.infer<typeof clientListQuerySchema>,
  ) {
    return this.clients.list(auth, q);
  }

  @RequirePermissions('client:read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string) {
    return this.clients.get(auth, id);
  }

  @RequirePermissions('client:write')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(updateClientSchema)) body: z.infer<typeof updateClientSchema>,
    @Req() req: AppRequest,
  ) {
    return this.clients.update(auth, id, body, req);
  }
}
