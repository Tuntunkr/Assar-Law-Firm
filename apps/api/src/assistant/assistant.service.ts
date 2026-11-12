import { Inject, Injectable } from '@nestjs/common';
import { assistantMessages, assistantThreads } from '@assar/database';
import { hasPermission, ROLE_PERMISSIONS, type Permission } from '@assar/types';
import {
  createClientSchema,
  createEventSchema,
  createMatterSchema,
  createTaskSchema,
  createTimeEntrySchema,
  objectIdSchema,
  recordPaymentSchema,
  taskListQuerySchema,
  voidInvoiceSchema,
} from '@assar/validation';
import { z, type ZodType, type ZodTypeDef } from 'zod';
import { CalendarService } from '../calendar/calendar.service';
import { InvoicesService } from '../billing/invoices.service';
import { TimeService } from '../billing/time.service';
import { ClientsService } from '../clients/clients.service';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { ApiError } from '../common/exception.filter';
import { ValidationFailed } from '../common/zod.pipe';
import { MattersService } from '../matters/matters.service';
import { TasksService } from '../tasks/tasks.service';
import { classify } from './classify';
import { guideChunks, searchGuide, type GuideChunk } from './guide';
import { runTool, type ToolServices } from './tools';

export const ASSISTANT_COMPOSER = Symbol('ASSISTANT_COMPOSER');

const REFUSAL = 'I can only help with this dashboard and the records your role can see.';

/** Passed to the composer for a help reply. It must not answer from outside the chunk. */
const HELP_SYSTEM =
  'Answer only from the chunk. When the chunk does not cover the question, say "I don\'t have that in the dashboard guide."';

const LOOKUP_SYSTEM = 'Phrase the tool data in plain sentences. Use only the data given.';

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'of',
  'and',
  'or',
  'for',
  'in',
  'on',
  'my',
  'how',
  'do',
  'i',
  'is',
  'it',
  'this',
  'that',
  'with',
  'your',
  'who',
  'what',
]);

const WRITE_PERMISSION: Record<string, Permission> = {
  'calendar.create': 'calendar:write',
  'tasks.create': 'task:write',
  'clients.create': 'client:write',
  'matters.open': 'matter:write',
  'time.create': 'time:write',
  'invoices.issue': 'billing:write',
  'invoices.pay': 'billing:write',
  'invoices.void': 'billing:write',
};

const MESSAGE_HISTORY = 12;
const THREAD_PAGE = 30;

export interface ComposerMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ComposeRequest {
  kind: 'help' | 'lookup';
  system: string;
  messages: ComposerMessage[];
  /** Guide chunk text. Set for help. */
  chunk?: string;
  /** Tool payload. Set for lookup. */
  data?: unknown;
}

/** Phrases a help or lookup reply. The API process does not hold a model key. */
export interface Composer {
  compose(request: ComposeRequest): Promise<string>;
}

type Req = Pick<AppRequest, 'ip' | 'id'>;

interface Proposal {
  tool: string;
  arguments: unknown;
  status: 'pending' | 'confirming' | 'done';
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function overlap(query: string, text: string): number {
  const have = new Set(words(text));
  let score = 0;
  for (const word of words(query)) {
    if (STOPWORDS.has(word)) continue;
    if (have.has(word)) score += 1;
  }
  return score;
}

/**
 * `searchGuide` counts every shared word, so "the" can select the Dashboard chunk.
 * A chunk is usable only when the question shares a word outside the stopword set.
 * On a tie, the chunk whose title shares one of those words wins.
 */
function selectChunk(query: string, permissions: readonly Permission[]): GuideChunk | null {
  const hit = searchGuide(query, [...permissions]);
  if (!hit || overlap(query, `${hit.title} ${hit.text}`) === 0) return null;

  let best = hit;
  let bestScore = overlap(query, `${hit.title} ${hit.text}`);
  let bestTitle = overlap(query, hit.title);
  for (const chunk of guideChunks) {
    if (chunk.permission !== null && !permissions.includes(chunk.permission)) continue;
    const score = overlap(query, `${chunk.title} ${chunk.text}`);
    const titleScore = overlap(query, chunk.title);
    if (score > bestScore || (score === bestScore && titleScore > bestTitle)) {
      best = chunk;
      bestScore = score;
      bestTitle = titleScore;
    }
  }
  return bestScore > 0 ? best : null;
}

function calledTitle(body: string): string | null {
  const match = body.match(/\b(?:called|named|titled)\s+(.+)$/i);
  const title = match?.[1]?.replace(/[.?!]+$/g, '').trim();
  if (!title || title.length < 2) return null;
  return title;
}

/** A leading Add or Create about a task becomes `tasks.create`. Other writes need the same shape. */
function parseAction(body: string): { tool: string; arguments: Record<string, unknown> } | null {
  if (/\btasks?\b/i.test(body)) {
    const title = calledTitle(body);
    if (!title) return null;
    return { tool: 'tasks.create', arguments: { title } };
  }
  if (/\bclients?\b/i.test(body)) {
    const name = calledTitle(body);
    if (!name) return null;
    return { tool: 'clients.create', arguments: { type: 'organization', name } };
  }
  return null;
}

function pickLookup(body: string): { tool: string; input: Record<string, unknown> } | null {
  const table: { re: RegExp; tool: string }[] = [
    { re: /\btasks?\b/i, tool: 'tasks.open' },
    { re: /\bclients?\b/i, tool: 'clients.find' },
    { re: /\bmatters?\b/i, tool: 'matters.find' },
    { re: /\binvoices?\b/i, tool: 'invoices.unpaid' },
    { re: /\bcalendars?\b/i, tool: 'calendar.upcoming' },
  ];
  let best: { index: number; tool: string } | null = null;
  for (const item of table) {
    const match = item.re.exec(body);
    if (!match || match.index === undefined) continue;
    if (!best || match.index < best.index) best = { index: match.index, tool: item.tool };
  }
  if (!best) return null;
  if (best.tool === 'clients.find') {
    const name = calledTitle(body);
    return { tool: best.tool, input: name ? { name } : {} };
  }
  if (best.tool === 'matters.find') {
    const number = calledTitle(body);
    return { tool: best.tool, input: number ? { number } : {} };
  }
  return { tool: best.tool, input: {} };
}

function readProposal(value: unknown): Proposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.tool !== 'string') return null;
  if (row.status !== 'pending' && row.status !== 'confirming' && row.status !== 'done') return null;
  if (!Object.hasOwn(row, 'arguments')) return null;
  return { tool: row.tool, arguments: row.arguments, status: row.status };
}

function parseWith<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationFailed(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function threadDto(thread: { _id: unknown; title: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: String(thread._id),
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function messageDto(message: {
  _id: unknown;
  threadId: unknown;
  role: 'user' | 'assistant';
  body: string;
  route?: string | null;
  toolName?: string | null;
  proposal?: unknown;
  createdAt: Date;
}) {
  return {
    id: String(message._id),
    threadId: String(message.threadId),
    role: message.role,
    body: message.body,
    route: message.route ?? null,
    toolName: message.toolName ?? null,
    proposal: message.proposal ?? null,
    createdAt: message.createdAt,
  };
}

/** One plain sentence. No network, and no echo of a document. */
function describeToolData(data: unknown): string {
  const record =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
  const rows = record && Array.isArray(record.data) ? record.data : [];
  const labels: string[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const item = row as Record<string, unknown>;
    const label = item.title ?? item.name ?? item.matterNumber ?? item.number;
    if (typeof label === 'string' && label.trim()) labels.push(label.trim());
    if (labels.length === 8) break;
  }
  const noun = rows.length === 1 ? 'record' : 'records';
  if (labels.length > 0) return `I found ${rows.length} ${noun}: ${labels.join(', ')}.`;
  return `I found ${rows.length} ${noun}.`;
}

/** Default composer. Help returns the chunk. Lookup describes the tool data. Neither uses the network. */
export const defaultComposer: Composer = {
  async compose(request) {
    if (request.kind === 'help') return request.chunk ?? '';
    return describeToolData(request.data);
  },
};

@Injectable()
export class AssistantService {
  constructor(
    @Inject(ASSISTANT_COMPOSER) private readonly composer: Composer,
    private readonly tasks: TasksService,
    private readonly clients: ClientsService,
    private readonly matters: MattersService,
    private readonly calendar: CalendarService,
    private readonly time: TimeService,
    private readonly invoices: InvoicesService,
  ) {}

  async createThread(auth: AuthContext, title?: string) {
    const thread = await assistantThreads.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      title: title?.trim() || 'New conversation',
    });
    return threadDto(thread);
  }

  async listThreads(auth: AuthContext) {
    const rows = await assistantThreads.list({
      organizationId: auth.organizationId,
      userId: auth.userId,
      limit: THREAD_PAGE,
    });
    return { data: rows.map(threadDto) };
  }

  async getThread(auth: AuthContext, threadId: string) {
    const thread = await this.ownedThread(auth, threadId);
    const messages = await assistantMessages.list({
      threadId,
      organizationId: auth.organizationId,
      userId: auth.userId,
      limit: 100,
    });
    if (!messages) throw new ApiError(404, 'NOT_FOUND', 'Thread not found');
    return { ...threadDto(thread), messages: messages.map(messageDto) };
  }

  async send(auth: AuthContext, threadId: string, body: string) {
    const userMessage = await assistantMessages.append({
      threadId,
      organizationId: auth.organizationId,
      userId: auth.userId,
      role: 'user',
      body,
    });
    if (!userMessage) throw new ApiError(404, 'NOT_FOUND', 'Thread not found');

    const route = classify(body);
    if (route === 'refuse') return this.reply(auth, threadId, { route: 'refuse', body: REFUSAL });
    if (route === 'help') return this.help(auth, threadId, body);
    if (route === 'lookup') return this.lookup(auth, threadId, body);
    return this.action(auth, threadId, body);
  }

  async confirm(auth: AuthContext, threadId: string, messageId: string, req: Req) {
    await this.ownedThread(auth, threadId);
    const scope = {
      threadId,
      organizationId: auth.organizationId,
      userId: auth.userId,
      messageId,
    };
    const claimed = await assistantMessages.claimProposal(scope);
    if (!claimed) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found');

    const proposal = readProposal(claimed.proposal);
    try {
      if (!proposal) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found');
      const permission = WRITE_PERMISSION[proposal.tool];
      if (!permission || !hasPermission(auth.role, permission)) {
        throw new ApiError(403, 'FORBIDDEN', 'You cannot do that.');
      }
      await this.perform(proposal.tool, proposal.arguments, auth, req);
    } catch (error) {
      await assistantMessages.releaseProposal(scope).catch(() => undefined);
      throw error;
    }

    const marked = await assistantMessages.markProposalDone(scope);
    if (!marked) throw new ApiError(404, 'NOT_FOUND', 'Proposal not found');
    return messageDto(marked);
  }

  private async ownedThread(auth: AuthContext, threadId: string) {
    const thread = await assistantThreads.findById({
      organizationId: auth.organizationId,
      userId: auth.userId,
      threadId,
    });
    if (!thread) throw new ApiError(404, 'NOT_FOUND', 'Thread not found');
    return thread;
  }

  private toolServices(): ToolServices {
    return {
      clients: { list: (auth, query) => this.clients.list(auth, query) },
      matters: { list: (auth, query) => this.matters.list(auth, query) },
      tasks: {
        list: (auth, query, req) =>
          this.tasks.list(auth, query as z.infer<typeof taskListQuerySchema>, req),
      },
      invoices: { list: (auth, query) => this.invoices.list(auth, query) },
      calendar: { list: (auth, query, req) => this.calendar.list(auth, query, req) },
    };
  }

  private async recent(auth: AuthContext, threadId: string): Promise<ComposerMessage[]> {
    const rows = await assistantMessages.list({
      threadId,
      organizationId: auth.organizationId,
      userId: auth.userId,
      limit: MESSAGE_HISTORY,
    });
    if (!rows) throw new ApiError(404, 'NOT_FOUND', 'Thread not found');
    return rows.map((row) => ({ role: row.role, content: row.body }));
  }

  private async help(auth: AuthContext, threadId: string, body: string) {
    const chunk = selectChunk(body, ROLE_PERMISSIONS[auth.role]);
    if (!chunk) return this.reply(auth, threadId, { route: 'refuse', body: REFUSAL });
    const text = await this.composer.compose({
      kind: 'help',
      system: HELP_SYSTEM,
      messages: await this.recent(auth, threadId),
      chunk: chunk.text,
    });
    return this.reply(auth, threadId, { route: 'help', body: text });
  }

  private async lookup(auth: AuthContext, threadId: string, body: string) {
    const picked = pickLookup(body);
    if (!picked) {
      return this.reply(auth, threadId, {
        route: 'lookup',
        body: 'I can look up a task, client, matter, invoice, or calendar.',
      });
    }
    const result = await runTool(picked.tool, picked.input, auth, this.toolServices());
    if (!result.ok) {
      const text =
        result.reason === 'forbidden'
          ? 'You cannot do that.'
          : result.reason === 'not_found'
            ? 'I could not find that.'
            : 'I need a more specific name or number to look that up.';
      return this.reply(auth, threadId, { route: 'lookup', body: text, toolName: picked.tool });
    }
    const text = await this.composer.compose({
      kind: 'lookup',
      system: LOOKUP_SYSTEM,
      messages: await this.recent(auth, threadId),
      data: result.data,
    });
    return this.reply(auth, threadId, { route: 'lookup', body: text, toolName: picked.tool });
  }

  private async action(auth: AuthContext, threadId: string, body: string) {
    const planned = parseAction(body);
    if (!planned) {
      return this.reply(auth, threadId, {
        route: 'action',
        body: 'Tell me what to add, including what it is called, and then confirm.',
      });
    }
    const result = await runTool(planned.tool, planned.arguments, auth, this.toolServices());
    if (!result.ok) {
      const body =
        result.reason === 'forbidden'
          ? 'You cannot do that.'
          : 'Tell me what to add, including what it is called, and then confirm.';
      return this.reply(auth, threadId, { route: 'action', body });
    }
    const kind = planned.tool === 'tasks.create' ? 'a task' : 'a client';
    const title = planned.arguments.title ?? planned.arguments.name;
    const named = typeof title === 'string' ? ` called "${title}"` : '';
    return this.reply(auth, threadId, {
      route: 'action',
      toolName: planned.tool,
      body: `I will add ${kind}${named}. Confirm to create it.`,
      proposal: { tool: planned.tool, arguments: planned.arguments, status: 'pending' },
    });
  }

  private async perform(tool: string, args: unknown, auth: AuthContext, req: Req) {
    switch (tool) {
      case 'tasks.create':
        return this.tasks.create(auth, parseWith(createTaskSchema, args), req);
      case 'clients.create':
        return this.clients.create(auth, parseWith(createClientSchema, args), req);
      case 'matters.open':
        return this.matters.create(auth, parseWith(createMatterSchema, args), req);
      case 'calendar.create':
        return this.calendar.create(auth, parseWith(createEventSchema, args), req);
      case 'time.create':
        return this.time.create(auth, parseWith(createTimeEntrySchema, args), req);
      case 'invoices.issue': {
        const input = parseWith(z.object({ id: objectIdSchema }), args);
        return this.invoices.issue(auth, input.id, req);
      }
      case 'invoices.pay': {
        const input = parseWith(recordPaymentSchema.extend({ id: objectIdSchema }), args);
        const { id, ...payment } = input;
        return this.invoices.recordPayment(auth, id, payment, req);
      }
      case 'invoices.void': {
        const input = parseWith(voidInvoiceSchema.extend({ id: objectIdSchema }), args);
        return this.invoices.void(auth, input.id, input.reason, req);
      }
      default:
        throw new ApiError(404, 'NOT_FOUND', 'Proposal not found');
    }
  }

  private async reply(
    auth: AuthContext,
    threadId: string,
    fields: {
      body: string;
      route: 'help' | 'lookup' | 'action' | 'refuse';
      toolName?: string | null;
      proposal?: Proposal | null;
    },
  ) {
    const saved = await assistantMessages.append({
      threadId,
      organizationId: auth.organizationId,
      userId: auth.userId,
      role: 'assistant',
      body: fields.body,
      route: fields.route,
      toolName: fields.toolName ?? null,
      proposal: fields.proposal ?? null,
    });
    if (!saved) throw new ApiError(404, 'NOT_FOUND', 'Thread not found');
    return messageDto(saved);
  }
}
