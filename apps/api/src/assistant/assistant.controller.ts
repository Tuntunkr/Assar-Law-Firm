import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { objectIdSchema, sendAssistantMessageSchema } from '@assar/validation';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RateLimit, RequirePermissions } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { AssistantService } from './assistant.service';

const createAssistantThreadSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

const confirmAssistantSchema = z.object({
  messageId: objectIdSchema,
});

@Controller('assistant')
@RequirePermissions('assistant:use')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('threads')
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createAssistantThreadSchema))
    body: z.infer<typeof createAssistantThreadSchema>,
  ) {
    return this.assistant.createThread(auth, body.title);
  }

  @Get('threads')
  list(@Auth() auth: AuthContext) {
    return this.assistant.listThreads(auth);
  }

  @Get('threads/:id')
  get(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string) {
    return this.assistant.getThread(auth, id);
  }

  @RateLimit({ name: 'assistant-message', limit: 20, windowSeconds: 600 })
  @Post('threads/:id/messages')
  send(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(sendAssistantMessageSchema)) body: z.infer<typeof sendAssistantMessageSchema>,
  ) {
    return this.assistant.send(auth, id, body.body);
  }

  @HttpCode(200)
  @Post('threads/:id/confirm')
  confirm(
    @Auth() auth: AuthContext,
    @Param('id', ObjectIdPipe) id: string,
    @Body(new ZodPipe(confirmAssistantSchema)) body: z.infer<typeof confirmAssistantSchema>,
    @Req() req: AppRequest,
  ) {
    return this.assistant.confirm(auth, id, body.messageId, req);
  }
}
