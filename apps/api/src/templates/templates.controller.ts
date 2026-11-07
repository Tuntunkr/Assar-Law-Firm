import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  createTemplateSchema,
  renderTemplateSchema,
  templateListQuerySchema,
  updateTemplateSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @RequirePermissions('document:read')
  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(templateListQuerySchema)) q: z.infer<typeof templateListQuerySchema>,
  ) {
    return this.templates.list(auth, q);
  }

  @RequirePermissions('document:read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string) {
    return this.templates.get(auth, id);
  }

  @RequirePermissions('document:write')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createTemplateSchema)) body: z.infer<typeof createTemplateSchema>,
    @Req() req: AppRequest,
  ) {
    return this.templates.create(auth, body, req);
  }

  @RequirePermissions('document:write')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(updateTemplateSchema)) body: z.infer<typeof updateTemplateSchema>,
    @Req() req: AppRequest,
  ) {
    return this.templates.update(auth, id, body, req);
  }

  @RequirePermissions('document:read')
  @HttpCode(200)
  @Post(':id/render')
  render(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(renderTemplateSchema)) body: z.infer<typeof renderTemplateSchema>,
    @Req() req: AppRequest,
  ) {
    return this.templates.render(auth, id, body, req);
  }
}
