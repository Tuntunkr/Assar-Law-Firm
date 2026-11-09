import { hasPermission, type Permission } from '@assar/types';
import type { AppRequest, AuthContext } from '../common/auth-context';

export type ToolResult =
  { ok: true; data: unknown } | { ok: false; reason: 'forbidden' | 'not_found' | 'invalid' };

type Req = Pick<AppRequest, 'ip' | 'id'>;

/** No HTTP request exists when Ask Assar calls a service. Matter checks only need this shape. */
const ASSISTANT_REQ: Req = { id: 'assistant', ip: '' };

const LIST_LIMIT = 100;
const FIND_LIMIT = 25;
const UPCOMING_LIMIT = 5;
const UPCOMING_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export interface ToolServices {
  clients: {
    list: (auth: AuthContext, query: { q?: string; limit: number }) => Promise<unknown>;
  };
  matters: {
    list: (auth: AuthContext, query: { q?: string; limit: number }) => Promise<unknown>;
  };
  tasks: {
    list: (
      auth: AuthContext,
      query: {
        assigneeId?: string;
        status?: 'todo' | 'in_progress' | 'done' | 'cancelled';
        limit: number;
      },
      req: Req,
    ) => Promise<unknown>;
  };
  invoices: {
    list: (
      auth: AuthContext,
      query: { status?: 'draft' | 'issued' | 'paid' | 'void'; limit: number },
    ) => Promise<unknown>;
  };
  calendar: {
    list: (
      auth: AuthContext,
      query: { from: Date; to: Date; limit: number },
      req: Req,
    ) => Promise<unknown>;
  };
}

type ReadTool = (input: unknown, auth: AuthContext, services: ToolServices) => Promise<ToolResult>;

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

function textField(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function pageRows(result: unknown): unknown[] {
  if (typeof result !== 'object' || result === null || !('data' in result)) return [];
  const data = result.data;
  return Array.isArray(data) ? data : [];
}

/** The task list takes one status. Open work is todo or in progress, assigned to the caller. */
async function listOpenTasks(
  _input: unknown,
  auth: AuthContext,
  services: ToolServices,
): Promise<ToolResult> {
  const [todo, inProgress] = await Promise.all([
    services.tasks.list(
      auth,
      { assigneeId: 'me', status: 'todo', limit: LIST_LIMIT },
      ASSISTANT_REQ,
    ),
    services.tasks.list(
      auth,
      { assigneeId: 'me', status: 'in_progress', limit: LIST_LIMIT },
      ASSISTANT_REQ,
    ),
  ]);
  return { ok: true, data: { data: [...pageRows(todo), ...pageRows(inProgress)] } };
}

async function findClient(
  input: unknown,
  auth: AuthContext,
  services: ToolServices,
): Promise<ToolResult> {
  const name = textField(input, 'name');
  if (!name) return { ok: false, reason: 'invalid' };
  const page = await services.clients.list(auth, { q: name, limit: FIND_LIMIT });
  if (pageRows(page).length === 0) return { ok: false, reason: 'not_found' };
  return { ok: true, data: page };
}

async function findMatter(
  input: unknown,
  auth: AuthContext,
  services: ToolServices,
): Promise<ToolResult> {
  const number = textField(input, 'number');
  if (!number) return { ok: false, reason: 'invalid' };
  const page = await services.matters.list(auth, { q: number, limit: FIND_LIMIT });
  if (pageRows(page).length === 0) return { ok: false, reason: 'not_found' };
  return { ok: true, data: page };
}

async function listUnpaid(
  _input: unknown,
  auth: AuthContext,
  services: ToolServices,
): Promise<ToolResult> {
  return {
    ok: true,
    data: await services.invoices.list(auth, { status: 'issued', limit: LIST_LIMIT }),
  };
}

async function listUpcoming(
  _input: unknown,
  auth: AuthContext,
  services: ToolServices,
): Promise<ToolResult> {
  const from = new Date();
  const to = new Date(from.getTime() + UPCOMING_WINDOW_MS);
  return {
    ok: true,
    data: await services.calendar.list(auth, { from, to, limit: UPCOMING_LIMIT }, ASSISTANT_REQ),
  };
}

const READ_TOOLS: Record<string, { permission: Permission; run: ReadTool }> = {
  'tasks.open': { permission: 'task:write', run: listOpenTasks },
  'clients.find': { permission: 'client:read', run: findClient },
  'matters.find': { permission: 'matter:read', run: findMatter },
  'invoices.unpaid': { permission: 'billing:read', run: listUnpaid },
  'calendar.upcoming': { permission: 'calendar:write', run: listUpcoming },
};

function ownPermission(table: Record<string, Permission>, name: string): Permission | undefined {
  if (!Object.hasOwn(table, name)) return undefined;
  return table[name];
}

/**
 * Runs one Ask Assar tool. Reads call the dashboard service after a permission check.
 * Writes return a proposal and do not call create or update.
 */
export async function runTool(
  name: string,
  input: unknown,
  auth: AuthContext,
  services: ToolServices,
): Promise<ToolResult> {
  const writePermission = ownPermission(WRITE_PERMISSION, name);
  if (writePermission) {
    if (!hasPermission(auth.role, writePermission)) return { ok: false, reason: 'forbidden' };
    return { ok: true, data: { proposal: { tool: name, arguments: input } } };
  }

  if (!Object.hasOwn(READ_TOOLS, name)) return { ok: false, reason: 'invalid' };
  const read = READ_TOOLS[name];
  if (!read) return { ok: false, reason: 'invalid' };
  if (!hasPermission(auth.role, read.permission)) return { ok: false, reason: 'forbidden' };
  return read.run(input, auth, services);
}
