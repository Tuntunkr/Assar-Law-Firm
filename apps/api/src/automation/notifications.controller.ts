import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { notifications, type NotificationDoc } from '@assar/database';
import { notificationListQuerySchema } from '@assar/validation';
import type { z } from 'zod';
import type { AuthContext } from '../common/auth-context';
import { Auth } from '../common/decorators';
import { ApiError } from '../common/exception.filter';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ZodPipe } from '../common/zod.pipe';

const dto = (n: NotificationDoc) => ({
  id: String(n._id),
  title: n.title,
  body: n.body ?? null,
  link: n.link ?? null,
  source: n.source,
  read: !!n.readAt,
  createdAt: n.createdAt,
});

/** A user's own in-app notifications. Always scoped to the signed-in user. */
@Controller('notifications')
export class NotificationsController {
  @Get()
  async list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(notificationListQuerySchema)) q: z.infer<typeof notificationListQuerySchema>,
  ) {
    const [page, unread] = await Promise.all([
      notifications.listForUser(auth.organizationId, auth.userId, {
        limit: q.limit,
        cursor: q.cursor,
        unreadOnly: q.unread,
      }),
      notifications.unreadCount(auth.organizationId, auth.userId),
    ]);
    return { data: page.data.map(dto), page: page.page, unread };
  }

  @HttpCode(200)
  @Post('read-all')
  async readAll(@Auth() auth: AuthContext) {
    await notifications.markAllRead(auth.organizationId, auth.userId);
    return { unread: 0 };
  }

  @HttpCode(200)
  @Post(':id/read')
  async read(@Auth() auth: AuthContext, @Param('id', ObjectIdPipe) id: string) {
    const n = await notifications.markRead(auth.organizationId, auth.userId, id);
    if (!n) throw new ApiError(404, 'NOT_FOUND', 'Notification not found');
    return dto(n);
  }
}
