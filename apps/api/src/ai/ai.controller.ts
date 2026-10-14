import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  aiJobListQuerySchema,
  aiOutputListQuerySchema,
  approveAiOutputSchema,
  createAiJobSchema,
  editAiOutputSchema,
  rejectAiOutputSchema,
} from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, Idempotent, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @RequirePermissions('ai:use')
  @Idempotent({ optional: true })
  @HttpCode(202)
  @Post('jobs')
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createAiJobSchema)) body: z.infer<typeof createAiJobSchema>,
    @Req() req: AppRequest,
  ) {
    return this.ai.create(auth, body, req);
  }

  @RequirePermissions('ai:use')
  @Get('jobs')
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(aiJobListQuerySchema)) q: z.infer<typeof aiJobListQuerySchema>,
    @Req() req: AppRequest,
  ) {
    return this.ai.list(auth, q, req);
  }

  @RequirePermissions('ai:use')
  @Get('jobs/:id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.ai.get(auth, id, req);
  }

  @RequirePermissions('ai:use')
  @HttpCode(200)
  @Post('jobs/:id/cancel')
  cancel(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.ai.cancel(auth, id, req);
  }

  @RequirePermissions('ai:use')
  @HttpCode(202)
  @Post('jobs/:id/retry')
  retry(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.ai.retry(auth, id, req);
  }

  @RequirePermissions('ai:use')
  @Get('outputs')
  listOutputs(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(aiOutputListQuerySchema)) q: z.infer<typeof aiOutputListQuerySchema>,
    @Req() req: AppRequest,
  ) {
    return this.ai.listOutputs(auth, q, req);
  }

  @RequirePermissions('ai:use')
  @Get('outputs/:id')
  getOutput(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.ai.getOutput(auth, id, req);
  }

  @RequirePermissions('ai:use')
  @Put('outputs/:id/edit')
  edit(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(editAiOutputSchema)) body: z.infer<typeof editAiOutputSchema>,
    @Req() req: AppRequest,
  ) {
    return this.ai.edit(auth, id, body.text, req);
  }

  /** Only roles with `ai:approve` (attorneys, admins, owner) can approve or reject. */
  @RequirePermissions('ai:approve')
  @HttpCode(200)
  @Post('outputs/:id/approve')
  approve(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(approveAiOutputSchema)) body: z.infer<typeof approveAiOutputSchema>,
    @Req() req: AppRequest,
  ) {
    return this.ai.approve(auth, id, body, req);
  }

  @RequirePermissions('ai:approve')
  @HttpCode(200)
  @Post('outputs/:id/reject')
  reject(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(rejectAiOutputSchema)) body: z.infer<typeof rejectAiOutputSchema>,
    @Req() req: AppRequest,
  ) {
    return this.ai.reject(auth, id, body.reason, req);
  }
}
