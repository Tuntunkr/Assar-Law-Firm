import type { AssistantRoute } from '@assar/types';
import { AssistantMessageModel, AssistantThreadModel } from '../models/index.js';

type Id = string | { toString(): string };

/**
 * Chat threads are private to the user who created them. Every query includes
 * `organizationId`. Listing, reading, and appending also include `userId`, so a thread
 * owned by someone else in the same firm is not found.
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
  /** Newest `updatedAt` first. Only threads this user owns. */
  async list(data: { organizationId: Id; userId: Id; limit?: number }) {
    const limit = data.limit && data.limit > 0 ? data.limit : 30;
    return AssistantThreadModel.find({
      organizationId: data.organizationId as never,
      userId: data.userId as never,
    })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit)
      .lean();
  },
  /** Null when the thread belongs to someone else in the same firm. */
  findById: (data: { organizationId: Id; userId: Id; threadId: Id }) =>
    AssistantThreadModel.findOne({
      _id: data.threadId as never,
      organizationId: data.organizationId as never,
      userId: data.userId as never,
    }).lean(),
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
  /** Null when this user does not own the thread, or the message is not in it. */
  async findForUser(data: { threadId: Id; organizationId: Id; userId: Id; messageId: Id }) {
    const thread = await AssistantThreadModel.findOne({
      _id: data.threadId as never,
      organizationId: data.organizationId as never,
      userId: data.userId as never,
    })
      .select('_id')
      .lean();
    if (!thread) return null;
    return AssistantMessageModel.findOne({
      _id: data.messageId as never,
      threadId: data.threadId as never,
      organizationId: data.organizationId as never,
    }).lean();
  },
  /**
   * Claims a pending proposal by setting `confirming` in the same update.
   * Null when this user does not own the thread, or the proposal is missing or not pending.
   * Does not change `append`.
   */
  claimProposal: (data: ProposalScope) => transitionProposal(data, 'pending', 'confirming'),
  /**
   * Sets a confirming proposal to `done`. Null when the thread is not this user's,
   * or the proposal is missing or not confirming. Does not change `append`.
   */
  markProposalDone: (data: ProposalScope) => transitionProposal(data, 'confirming', 'done'),
  /**
   * Sets a confirming proposal back to `pending` so a failed confirm can be retried.
   * Null when it is not confirming.
   */
  releaseProposal: (data: ProposalScope) => transitionProposal(data, 'confirming', 'pending'),
};

type ProposalScope = { threadId: Id; organizationId: Id; userId: Id; messageId: Id };

/**
 * One update, scoped to this user's thread. Matches only `from`, so two confirms
 * cannot both claim the same pending proposal.
 */
async function transitionProposal(
  data: ProposalScope,
  from: 'pending' | 'confirming',
  to: 'pending' | 'confirming' | 'done',
) {
  const thread = await AssistantThreadModel.findOne({
    _id: data.threadId as never,
    organizationId: data.organizationId as never,
    userId: data.userId as never,
  })
    .select('_id')
    .lean();
  if (!thread) return null;
  return AssistantMessageModel.findOneAndUpdate(
    {
      _id: data.messageId as never,
      threadId: data.threadId as never,
      organizationId: data.organizationId as never,
      'proposal.status': from,
    },
    { $set: { 'proposal.status': to } },
    { returnDocument: 'after' },
  ).lean();
}
