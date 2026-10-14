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
  Req,
} from '@nestjs/common';
import { createTeamSchema, setTeamMembersSchema, updateTeamSchema } from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { TeamsService } from './teams.service';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @RequirePermissions('user:manage')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createTeamSchema)) body: z.infer<typeof createTeamSchema>,
    @Req() req: AppRequest,
  ) {
    return this.teams.create(auth, body, req);
  }

  @RequirePermissions('matter:read')
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.teams.list(auth);
  }

  @RequirePermissions('matter:read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string) {
    return this.teams.get(auth, id);
  }

  @RequirePermissions('user:manage')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(updateTeamSchema)) body: z.infer<typeof updateTeamSchema>,
    @Req() req: AppRequest,
  ) {
    return this.teams.update(auth, id, body, req);
  }

  @RequirePermissions('user:manage')
  @Put(':id/members')
  setMembers(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(setTeamMembersSchema)) body: z.infer<typeof setTeamMembersSchema>,
    @Req() req: AppRequest,
  ) {
    return this.teams.setMembers(auth, id, body, req);
  }

  @RequirePermissions('user:manage')
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    await this.teams.remove(auth, id, req);
  }
}
