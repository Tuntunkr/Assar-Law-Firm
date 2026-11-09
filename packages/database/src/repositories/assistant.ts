import type { AssistantRoute } from '@assar/types';
import { AssistantMessageModel, AssistantThreadModel } from '../models/index.js';

type Id = string | { toString(): string };

/**
 * Chat threads are private to the user who created them. Every query includes
 * `organizationId`. Listing and appending also include `userId`, so a thread owned
 * by someone else in the same firm is not found.
 */
export const assistantThreads = {
  create: async (data: { organizationId: Id; userId: Id; title: string }) =>
    (
      await AssistantThreadModel.create({
        organizationId: data.organizationId as never,
        userId: data.userId as never,
        title: data.title,
      })
    ).toObject(),
};

export const assistantMessages = {
  append: async (data: {
    threadId: Id;
    organizationId: Id;
    userId: Id;
    role: 'user' | 'assistant';
    body: string;
    toolName?: string | null;
    proposal?: unknown;
    route?: AssistantRoute | null;
  }) => {
    const thread = await AssistantThreadModel.findOne({
      _id: data.threadId as never,
      organizationId: data.organizationId as never,
      userId: data.userId as never,
    })
      .select('_id')
      .lean();
    if (!thread) return null;
    const message = (
      await AssistantMessageModel.create({
        organizationId: data.organizationId as never,
        threadId: data.threadId as never,
        role: data.role,
        body: data.body,
        route: data.route ?? null,
        toolName: data.toolName ?? null,
        proposal: data.proposal ?? null,
      })
    ).toObject();
    await AssistantThreadModel.updateOne(
      {
        _id: data.threadId as never,
        organizationId: data.organizationId as never,
        userId: data.userId as never,
      },
      { $currentDate: { updatedAt: true } },
    );
    return message;
  },
  /**
   * Latest `limit` messages (default 12), oldest first.
   * Returns null when this user has no such thread in the organization.
   */
  async list(data: { threadId: Id; organizationId: Id; userId: Id; limit?: number }) {
    const thread = await AssistantThreadModel.findOne({
      _id: data.threadId as never,
      organizationId: data.organizationId as never,
      userId: data.userId as never,
    })
      .select('_id')
      .lean();
    if (!thread) return null;
    const limit = data.limit && data.limit > 0 ? data.limit : 12;
    const rows = await AssistantMessageModel.find({
      threadId: data.threadId as never,
      organizationId: data.organizationId as never,
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    return rows.reverse();
  },
};
