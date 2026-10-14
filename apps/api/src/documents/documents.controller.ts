import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createDocumentSchema,
  documentListQuerySchema,
  newVersionSchema,
  renameDocumentSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Idempotent, RequirePermissions } from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { DocumentsService } from './documents.service';

const versionNo = (v: string) => {
  if (!/^\d{1,6}$/.test(v)) throw new ApiError(404, 'NOT_FOUND', 'Version not found');
  return Number(v);
};

@Controller()
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @RequirePermissions('document:write')
  @Idempotent({ optional: true })
  @Post('matters/:matterId/documents')
  create(
    @Auth() auth: AuthContext,
    @Param('matterId', ObjectIdPipe) matterId: string,
    @Body(new ZodPipe(createDocumentSchema)) body: z.infer<typeof createDocumentSchema>,
    @Req() req: AppRequest,
  ) {
    return this.docs.create(auth, matterId, body, req);
  }

  @RequirePermissions('document:read')
  @Get('matters/:matterId/documents')
  list(
    @Auth() auth: AuthContext,
    @Param('matterId', ObjectIdPipe) matterId: string,
    @Query(new ZodPipe(documentListQuerySchema)) q: z.infer<typeof documentListQuerySchema>,
    @Req() req: AppRequest,
  ) {
    return this.docs.list(auth, matterId, q, req);
  }

  @RequirePermissions('document:read')
  @Get('documents/:id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.docs.get(auth, id, req);
  }

  @RequirePermissions('document:write')
  @Patch('documents/:id')
  rename(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(renameDocumentSchema)) body: z.infer<typeof renameDocumentSchema>,
    @Req() req: AppRequest,
  ) {
    return this.docs.rename(auth, id, body.title, req);
  }

  @RequirePermissions('document:write')
  @HttpCode(204)
  @Delete('documents/:id')
  async remove(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    await this.docs.remove(auth, id, req);
  }

  @RequirePermissions('document:write')
  @Post('documents/:id/versions')
  addVersion(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(newVersionSchema)) body: z.infer<typeof newVersionSchema>,
    @Req() req: AppRequest,
  ) {
    return this.docs.addVersion(auth, id, body, req);
  }

  @RequirePermissions('document:write')
  @HttpCode(200)
  @Post('documents/:id/versions/:version/complete')
  complete(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('version') v: string,
    @Req() req: AppRequest,
  ) {
    return this.docs.complete(auth, id, versionNo(v), req);
  }

  @RequirePermissions('document:write')
  @HttpCode(200)
  @Post('documents/:id/versions/:version/rescan')
  rescan(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('version') v: string,
    @Req() req: AppRequest,
  ) {
    return this.docs.rescan(auth, id, versionNo(v), req);
  }

  @RequirePermissions('document:read')
  @HttpCode(200)
  @Post('documents/:id/versions/:version/download-link')
  downloadLink(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Param('version') v: string,
    @Req() req: AppRequest,
  ) {
    return this.docs.downloadLink(auth, id, versionNo(v), req);
  }
}
