import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { eventSlug } from '@assar/jobs';
import { WORKFLOW_EVENTS } from '@assar/types';
import { automationNotificationSchema, automationTaskSchema } from '@assar/validation';
import { describe, expect, it } from 'vitest';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows');

interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  credentials?: Record<string, { id: string; name: string }>;
  retryOnFail?: boolean;
}
interface Workflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: { node: string; type: string; index: number }[][] }>;
  active: boolean;
  settings: Record<string, unknown>;
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();
const flows = new Map<string, Workflow>(
  files.map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8')) as Workflow]),
);
const raw = new Map(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

/** Node types these workflows are allowed to use: all are core n8n nodes. */
const KNOWN_TYPES = new Set([
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.set',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.splitOut',
  'n8n-nodes-base.code',
]);
const TRIGGERS = new Set(['n8n-nodes-base.webhook', 'n8n-nodes-base.scheduleTrigger']);
/** Everything a workflow may call, with the service-token scope each needs. */
const ENDPOINTS: Record<string, string> = {
  'GET /automation/matters/': 'matters:read',
  'GET /automation/reminders/due': 'reminders:read',
  'GET /automation/reports/daily': 'reports:read',
  'POST /automation/notifications': 'notifications:write',
  'POST /automation/tasks': 'tasks:write',
};

/** `METHOD /automation/...` for an HTTP Request node. */
function endpointOf(n: N8nNode): string {
  const path = /'(\/automation\/[^']*)'/.exec(String(n.parameters.url))?.[1] ?? '';
  return `${n.parameters.method} ${path.startsWith('/automation/matters/') ? '/automation/matters/' : path.split('?')[0]}`;
}
const httpNodes = (wf: Workflow) => wf.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest');

describe('workflow definitions', () => {
  it('ships the five expected workflows', () => {
    expect(files).toEqual([
      'ai-draft-ready.json',
      'daily-report.json',
      'deadline-reminders.json',
      'document-review-task.json',
      'matter-onboarding.json',
    ]);
  });

  describe.each(files)('%s', (file) => {
    const wf = flows.get(file)!;
    const byName = new Map(wf.nodes.map((n) => [n.name, n]));

    it('is well-formed, inactive by default, and uses only core n8n nodes', () => {
      expect(wf.name).toMatch(/^Assar: /);
      expect(wf.active).toBe(false); // an operator activates it after wiring credentials
      expect(wf.settings.executionOrder).toBe('v1');
      expect(new Set(wf.nodes.map((n) => n.id)).size).toBe(wf.nodes.length);
      expect(byName.size).toBe(wf.nodes.length);
      for (const n of wf.nodes) {
        expect(KNOWN_TYPES.has(n.type), `${n.name}: ${n.type}`).toBe(true);
        expect(n.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(n.position).toHaveLength(2);
      }
      expect(wf.nodes.filter((n) => TRIGGERS.has(n.type))).toHaveLength(1);
    });

    it('has a connected, acyclic graph starting at the trigger', () => {
      for (const [from, outs] of Object.entries(wf.connections)) {
        expect(byName.has(from), `connection from unknown node ${from}`).toBe(true);
        for (const branch of outs.main) {
          for (const to of branch) expect(byName.has(to.node), `${from} -> ${to.node}`).toBe(true);
        }
      }
      const trigger = wf.nodes.find((n) => TRIGGERS.has(n.type))!;
      const seen = new Set<string>();
      const walk = (name: string) => {
        expect(seen.has(name), `cycle at ${name}`).toBe(false);
        seen.add(name);
        for (const branch of wf.connections[name]?.main ?? [])
          for (const to of branch) walk(to.node);
      };
      walk(trigger.name);
      expect([...seen].sort()).toEqual(wf.nodes.map((n) => n.name).sort()); // nothing orphaned
    });

    it('authenticates through n8n credentials and never embeds a secret', () => {
      const text = raw.get(file)!;
      expect(text).not.toMatch(/ast_[\w-]{10,}/); // service tokens
      expect(text).not.toMatch(/Bearer\s/i);
      expect(text).not.toMatch(/"authorization"/i);
      expect(text).not.toMatch(/\$env|process\.env|require\(/);
      const withoutIds = text.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '',
      );
      expect(withoutIds).not.toMatch(/[0-9a-f]{32,}/i); // no long hex secrets

      for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.webhook')) {
        expect(n.parameters.authentication).toBe('headerAuth'); // callers must present the shared secret
        expect(n.parameters.httpMethod).toBe('POST');
        expect(n.parameters.path).toMatch(/^assar\/[a-z-]+$/);
        expect(n.credentials?.httpHeaderAuth?.name).toBe('Assar webhook token');
      }
      for (const n of httpNodes(wf)) {
        expect(n.parameters.authentication).toBe('genericCredentialType');
        expect(n.parameters.genericAuthType).toBe('httpHeaderAuth');
        expect(n.credentials?.httpHeaderAuth?.name).toBe('Assar automation token');
        expect(n.retryOnFail).toBe(true);
      }
    });

    it('calls only whitelisted /automation endpoints, via the configurable API URL', () => {
      const cfg = byName.get('Config')!;
      expect(cfg.parameters.assignments.assignments.map((a: { name: string }) => a.name)).toEqual([
        'apiUrl',
      ]);
      expect(cfg.parameters.assignments.assignments[0].value).toMatch(/^https:\/\/.+\/v1$/);

      for (const n of httpNodes(wf)) {
        expect(String(n.parameters.url)).toContain("$('Config').first().json.apiUrl"); // no hardcoded host
        expect(Object.keys(ENDPOINTS), `${n.name} calls ${endpointOf(n)}`).toContain(endpointOf(n));
      }
    });

    it('makes every write idempotent', () => {
      for (const n of httpNodes(wf).filter((x) => x.parameters.method === 'POST')) {
        if (endpointOf(n) === 'POST /automation/tasks') {
          const header = n.parameters.headerParameters?.parameters?.find(
            (h: { name: string }) => h.name === 'Idempotency-Key',
          );
          expect(header, `${n.name} needs an Idempotency-Key`).toBeTruthy();
        } else {
          expect(String(n.parameters.jsonBody)).toContain('dedupeKey');
        }
      }
    });
  });

  it('listens on exactly the webhook path the platform delivers each event to', () => {
    const paths = [...flows.values()].flatMap((wf) =>
      wf.nodes
        .filter((n) => n.type === 'n8n-nodes-base.webhook')
        .map((n) => String(n.parameters.path)),
    );
    // Delivery goes to <base>/<eventSlug>, and the base ends in /webhook/assar, so each path is `assar/<slug>`.
    expect(paths.sort()).toEqual(WORKFLOW_EVENTS.map((e) => `assar/${eventSlug(e)}`).sort());
  });

  it('together need exactly the documented scopes', () => {
    const needed = new Set<string>();
    for (const wf of flows.values())
      for (const n of httpNodes(wf)) needed.add(ENDPOINTS[endpointOf(n)]!);
    expect([...needed].sort()).toEqual([
      'matters:read',
      'notifications:write',
      'reminders:read',
      'reports:read',
      'tasks:write',
    ]);
  });
});

// ---------- run the workflows' logic against the API's real request schemas ----------

type Item = { json: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A tiny emulation of the n8n Code-node runtime: enough to execute our nodes' JavaScript. */
function runCode(node: N8nNode, input: Item[], named: Record<string, Item[]>): Item[] {
  const js = node.parameters.jsCode as string;
  const each = node.parameters.mode === 'runOnceForEachItem';
  const handle = (items: Item[]) => ({ first: () => items[0], all: () => items, item: items[0] });
  const $ = (name: string) => handle(named[name] ?? []);
  const run = (items: Item[]) =>
    runInNewContext(`(function () { ${js} \n})()`, { $, $input: handle(items), Date, JSON, Math });
  if (!each) return run(input) as Item[];
  return input.map((it) => run([it]) as Item);
}

/** Evaluates an n8n `={{ ... }}` expression for one item. */
function evalExpr(expr: string, json: Record<string, unknown>): unknown {
  const inner = expr.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return runInNewContext(`(${inner})`, { $json: json, JSON, Date });
}

const uid = (c: string) => c.repeat(24);
const nodeOf = (file: string, name: string) => flows.get(file)!.nodes.find((n) => n.name === name)!;
const taskCall = (file: string, items: Item[]) =>
  items.map((it) => {
    const create = nodeOf(file, 'Create task');
    return {
      body: JSON.parse(evalExpr(create.parameters.jsonBody, it.json) as string),
      key: evalExpr(create.parameters.headerParameters.parameters[0].value, it.json) as string,
    };
  });
const notifyCall = (file: string, items: Item[]) =>
  items.map((it) =>
    JSON.parse(
      evalExpr(nodeOf(file, 'Create notification').parameters.jsonBody, it.json) as string,
    ),
  );

describe('workflow logic matches the API contract', () => {
  const event = (data: object) => ({
    json: {
      body: {
        id: 'evt-job-1',
        event: 'x',
        organizationId: uid('1'),
        occurredAt: new Date().toISOString(),
        data,
      },
    },
  });

  it('matter onboarding creates valid, idempotent checklist tasks for the lead attorney', () => {
    const f = 'matter-onboarding.json';
    const named = {
      Webhook: [event({ matterId: uid('a'), createdBy: uid('b'), restricted: false })],
    };
    const withLead = runCode(
      nodeOf(f, 'Plan checklist'),
      [
        {
          json: { id: uid('a'), leadAttorneyId: uid('c'), createdBy: uid('b'), restricted: false },
        },
      ],
      named,
    );
    const calls = taskCall(f, withLead);
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(automationTaskSchema.safeParse(c.body).success, JSON.stringify(c.body)).toBe(true);
      expect(c.body).toMatchObject({ matterId: uid('a'), assigneeId: uid('c') });
      expect(c.key).toMatch(/^[\w-]{8,128}$/); // the API's Idempotency-Key format
    }
    expect(new Set(calls.map((c) => c.key)).size).toBe(4); // distinct per step, stable per event

    const noLead = () =>
      runCode(
        nodeOf(f, 'Plan checklist'),
        [{ json: { id: uid('a'), leadAttorneyId: null, createdBy: uid('b') } }],
        named,
      );
    expect(taskCall(f, noLead())[0]!.body.assigneeId).toBe(uid('b')); // falls back to whoever opened the matter
    expect(taskCall(f, noLead()).map((c) => c.key)).toEqual(
      taskCall(f, noLead()).map((c) => c.key),
    ); // redelivery -> same keys
  });

  it('document review creates one valid task, without copying any document details', () => {
    const f = 'document-review-task.json';
    const named = {
      Webhook: [
        event({ documentId: uid('d'), version: 1, matterId: uid('a'), uploadedBy: uid('e') }),
      ],
    };
    const out = runCode(
      nodeOf(f, 'Plan review task'),
      [{ json: { id: uid('a'), leadAttorneyId: null, createdBy: uid('b') } }],
      named,
    );
    const [call] = taskCall(f, out);
    expect(out).toHaveLength(1);
    expect(automationTaskSchema.safeParse(call!.body).success).toBe(true);
    expect(call!.body.assigneeId).toBe(uid('e')); // the uploader, when there is no lead attorney
    expect(call!.key).toBe('document-review-evt-job-1');
    expect(JSON.stringify(call)).not.toContain(uid('d'));
  });

  it('AI-draft notifications are valid, link to the draft, and are deduplicated per output', () => {
    const f = 'ai-draft-ready.json';
    const named = {
      Webhook: [
        event({
          outputId: uid('9'),
          jobId: uid('8'),
          matterId: uid('a'),
          requestedBy: uid('7'),
          task: 'summary',
        }),
      ],
    };
    const [n] = notifyCall(f, runCode(nodeOf(f, 'Build notification'), [], named));
    expect(automationNotificationSchema.safeParse(n).success, JSON.stringify(n)).toBe(true);
    expect(n).toMatchObject({
      recipientUserId: uid('7'),
      link: { type: 'ai_output', id: uid('9') },
      dedupeKey: `ai-ready-${uid('9')}`,
    });
    expect(n.body).toMatch(/unverified until a lawyer reviews/);
  });

  it('reminders turn each due item into a valid notification, even with very long titles', () => {
    const f = 'deadline-reminders.json';
    const item = {
      kind: 'event',
      itemId: uid('5'),
      title: 'T'.repeat(500),
      dueAt: '2031-03-01T10:00:00.000Z',
      matterId: null,
      recipientUserId: uid('6'),
      dedupeKey: `event:${uid('5')}:${uid('6')}:2031-03-01`,
    };
    const [n] = notifyCall(f, runCode(nodeOf(f, 'Build notification'), [{ json: item }], {}));
    expect(automationNotificationSchema.safeParse(n).success, JSON.stringify(n)).toBe(true);
    expect(n.title.length).toBeLessThanOrEqual(200);
    expect(n).toMatchObject({ link: { type: 'event', id: uid('5') }, dedupeKey: item.dedupeKey });
  });

  it('the daily report sends one valid, counts-only summary per recipient', () => {
    const f = 'daily-report.json';
    const report = {
      date: '2031-03-01',
      counts: {
        openMatters: 4,
        overdueTasks: 2,
        upcomingDeadlines: 1,
        pendingDrafts: 3,
        scanFailures: 0,
      },
      recipients: [uid('1'), uid('2')],
    };
    const calls = notifyCall(f, runCode(nodeOf(f, 'Build notifications'), [{ json: report }], {}));
    expect(calls).toHaveLength(2);
    for (const n of calls) {
      expect(automationNotificationSchema.safeParse(n).success, JSON.stringify(n)).toBe(true);
      expect(n.body).toMatch(/Open matters: 4\. Overdue tasks: 2\./);
    }
    expect(new Set(calls.map((n) => n.dedupeKey)).size).toBe(2);
    expect(calls[0].dedupeKey).toBe(`daily-report-2031-03-01-${uid('1')}`);
  });
});
