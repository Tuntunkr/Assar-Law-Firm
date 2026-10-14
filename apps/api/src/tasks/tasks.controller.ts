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
import { createTaskSchema, taskListQuerySchema, updateTaskSchema } from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @RequirePermissions('task:write')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createTaskSchema)) body: z.infer<typeof createTaskSchema>,
    @Req() req: AppRequest,
  ) {
    return this.tasks.create(auth, body, req);
  }

  @RequirePermissions('matter:read')
  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(taskListQuerySchema)) q: z.infer<typeof taskListQuerySchema>,
    @Req() req: AppRequest,
  ) {
    return this.tasks.list(auth, q, req);
  }

  @RequirePermissions('matter:read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string, @Req() req: AppRequest) {
    return this.tasks.get(auth, id, req);
  }

  @RequirePermissions('task:write')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(updateTaskSchema)) body: z.infer<typeof updateTaskSchema>,
    @Req() req: AppRequest,
  ) {
    return this.tasks.update(auth, id, body, req);
  }

  @RequirePermissions('task:write')
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Req() req: AppRequest,
  ) {
    await this.tasks.remove(auth, id, req);
  }
}
