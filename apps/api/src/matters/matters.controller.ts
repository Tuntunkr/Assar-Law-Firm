import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  createMatterSchema,
  createPartySchema,
  matterListQuerySchema,
  setMatterAccessSchema,
  updateMatterSchema,
  updatePartySchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Idempotent, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { MattersService } from './matters.service';

@Controller('matters')
export class MattersController {
  constructor(private readonly matters: MattersService) {}

  @RequirePermissions('matter:write')
  @Idempotent({ optional: true })
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createMatterSchema)) body: z.infer<typeof createMatterSchema>,
    @Req() req: AppRequest,
  ) {
    return this.matters.create(auth, body, req);
  }

  @RequirePermissions('matter:read')
  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(matterListQuerySchema)) q: z.infer<typeof matterListQuerySchema>,
  ) {
    return this.matters.list(auth, q);
  }

  @RequirePermissions('matter:read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.matters.get(auth, id, req);
  }

  @RequirePermissions('matter:write')
  @Post(':id/court/verify')
  verifyCourt(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.matters.verifyCourt(auth, id, req);
  }

  @RequirePermissions('matter:write')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(updateMatterSchema)) body: z.infer<typeof updateMatterSchema>,
    @Req() req: AppRequest,
  ) {
    return this.matters.update(auth, id, body, req);
  }

  @RequirePermissions('matter:write')
  @Get(':id/access')
  getAccess(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.matters.getAccess(auth, id, req);
  }

  @RequirePermissions('matter:write')
  @Put(':id/access')
  setAccess(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(setMatterAccessSchema)) body: z.infer<typeof setMatterAccessSchema>,
    @Req() req: AppRequest,
  ) {
    return this.matters.setAccess(auth, id, body, req);
  }

  @RequirePermissions('matter:read')
  @Get(':id/parties')
  parties(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.matters.listParties(auth, id, req);
  }

  @RequirePermissions('matter:write')
  @Post(':id/parties')
  addParty(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(createPartySchema)) body: z.infer<typeof createPartySchema>,
    @Req() req: AppRequest,
  ) {
    return this.matters.addParty(auth, id, body, req);
  }

  @RequirePermissions('matter:write')
  @Patch(':id/parties/:partyId')
  updateParty(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('partyId', ObjectIdPipe) partyId: string,
    @Body(new ZodPipe(updatePartySchema)) body: z.infer<typeof updatePartySchema>,
    @Req() req: AppRequest,
  ) {
    return this.matters.updateParty(auth, id, partyId, body, req);
  }

  @RequirePermissions('matter:write')
  @HttpCode(204)
  @Delete(':id/parties/:partyId')
  async removeParty(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('partyId', ObjectIdPipe) partyId: string,
    @Req() req: AppRequest,
  ) {
    await this.matters.removeParty(auth, id, partyId, req);
  }
}
