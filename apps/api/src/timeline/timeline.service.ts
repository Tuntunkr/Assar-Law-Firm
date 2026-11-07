import { Injectable } from '@nestjs/common';
import { clients, matters, timeline } from '@assar/database';
import type { z } from 'zod';
import type { timelineQuerySchema } from '@assar/validation';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { MatterAccessService } from '../matters/matter-access.service';

type Q = z.infer<typeof timelineQuerySchema>;
type Req = Pick<AppRequest, 'ip' | 'id'>;

@Injectable()
export class TimelineService {
  constructor(private readonly access: MatterAccessService) {}

  private async page(auth: AuthContext, matterIds: string[], q: Q) {
    const entries = await timeline.forMatters(auth.organizationId, matterIds, {
      limit: q.limit + 1,
      before: q.before,
      hiddenMatterIds: await this.access.hiddenMatterIds(auth),
    });
    const more = entries.length > q.limit;
    const data = entries.slice(0, q.limit).map((e) => ({ ...e, at: e.at.toISOString() }));
    return { data, page: { nextBefore: more ? data[data.length - 1]!.at : null, limit: q.limit } };
  }

  async forMatter(auth: AuthContext, matterId: string, q: Q, req: Req) {
    await this.access.load(auth, matterId, req); // 404 for hidden matters
    return this.page(auth, [matterId], q);
  }

  /** Everything on the client's matters that the viewer is allowed to see. */
  async forClient(auth: AuthContext, clientId: string, q: Q) {
    if (!(await clients.findById(auth.organizationId, clientId)))
      throw new ApiError(404, 'NOT_FOUND', 'Client not found');
    const hidden = new Set(await this.access.hiddenMatterIds(auth));
    const ids = (await matters.idsForClient(auth.organizationId, clientId))
      .map(String)
      .filter((id) => !hidden.has(id));
    return this.page(auth, ids, q);
  }
}
