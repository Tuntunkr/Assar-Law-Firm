import type { INestApplication } from '@nestjs/common';
import { AuditLogModel } from '@assar/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bootApp, newMatter, patch, post, registerWithMfa } from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await app.close();
});

type T = { id: string; name: string; placeholders: string[]; status: string; starter: boolean };
const names = (r: { body: { data: T[] } }) => r.body.data.map((t) => t.name).sort();
const find = (r: { body: { data: T[] } }, name: string) =>
  r.body.data.find((t) => t.name === name)!;

describe('template library', () => {
  it('starts every firm with the shipped templates, once, and keeps them editable', async () => {
    const o = await registerWithMfa(app);
    const list = await o.agent.get('/v1/templates').expect(200);
    expect(names(list)).toEqual([
      'Engagement letter',
      'Legal notice',
      'Mutual non-disclosure agreement',
      'Petition (skeleton)',
      'Services agreement',
    ]);
    expect(find(list, 'Legal notice')).toMatchObject({ starter: true, status: 'active' });
    expect(find(list, 'Legal notice').placeholders).toEqual(
      expect.arrayContaining(['client.name', 'notice.demand']),
    );
    expect(JSON.stringify(list.body)).not.toContain('FOR ATTORNEY REVIEW'); // listing has no bodies

    // Asking again does not duplicate them, even concurrently.
    await Promise.all([
      o.agent.get('/v1/templates'),
      o.agent.get('/v1/templates'),
      o.agent.get('/v1/templates'),
    ]);
    expect((await o.agent.get('/v1/templates').expect(200)).body.data).toHaveLength(5);

    const full = (await o.agent.get(`/v1/templates/${find(list, 'Legal notice').id}`).expect(200))
      .body;
    expect(full.body).toContain('DRAFT FOR ATTORNEY REVIEW');
  });

  it('creates, edits and archives templates, deriving placeholders from the body', async () => {
    const o = await registerWithMfa(app);
    const created = await post(o, '/v1/templates', {
      name: 'Rent reminder',
      category: 'letter',
      body: 'Dear {{client.name}}, rent of {{rent.amount}} is due on {{rent.due_date}}. {{client.name}}',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.placeholders).toEqual(['client.name', 'rent.amount', 'rent.due_date']);
    expect(
      (
        await post(o, '/v1/templates', {
          name: 'rent REMINDER',
          category: 'letter',
          body: 'Another body here',
        })
      ).status,
    ).toBe(409);

    const edited = await patch(o, `/v1/templates/${created.body.id}`, {
      body: 'Hello {{only.one}} placeholder here',
    });
    expect(edited.body).toMatchObject({ placeholders: ['only.one'], revision: 2 });

    await patch(o, `/v1/templates/${created.body.id}`, { status: 'archived' }).then((r) =>
      expect(r.body.status).toBe('archived'),
    );
    expect(names(await o.agent.get('/v1/templates'))).not.toContain('Rent reminder');
    expect(names(await o.agent.get('/v1/templates?status=archived'))).toEqual(['Rent reminder']);
  });

  it('validates input and enforces permissions and organization isolation', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const staff = await addMember(app, owner, 'staff'); // document:read but not document:write
    const billing = await addMember(app, owner, 'billing'); // no document access
    const ok = await post(attorney, '/v1/templates', {
      name: 'Mine',
      category: 'notice',
      body: 'Notice to {{client.name}}.',
    });
    expect(ok.status).toBe(201);
    expect(
      (await post(attorney, '/v1/templates', { name: 'x', category: 'nope', body: 'short' }))
        .status,
    ).toBe(400);
    expect(
      (
        await post(attorney, '/v1/templates', {
          name: 'Huge',
          category: 'notice',
          body: 'x'.repeat(50_001),
        })
      ).status,
    ).toBe(400);

    expect((await staff.agent.get('/v1/templates')).status).toBe(200);
    expect(
      (
        await post(staff, '/v1/templates', {
          name: 'Nope',
          category: 'notice',
          body: 'Notice to someone.',
        })
      ).status,
    ).toBe(403);
    expect((await billing.agent.get('/v1/templates')).status).toBe(403);

    const other = await registerWithMfa(app, 'Other');
    expect((await other.agent.get(`/v1/templates/${ok.body.id}`)).status).toBe(404);
    expect((await patch(other, `/v1/templates/${ok.body.id}`, { name: 'Hijack' })).status).toBe(
      404,
    );
    expect(names(await other.agent.get('/v1/templates'))).not.toContain('Mine');
  });
});

describe('filling a template', () => {
  async function setup() {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const client = await post(owner, '/v1/clients', {
      type: 'organization',
      name: 'Acme Holdings LLC',
      email: 'legal@acme.test',
      address: '1 Main St, Delhi',
    });
    const matter = await newMatter(owner, client.body.id, {
      title: 'Lease Dispute',
      court: {
        name: 'High Court of Delhi',
        caseNumber: 'CS 12/2026',
        jurisdiction: 'Delhi',
        filedOn: '2026-03-04',
      },
      leadAttorneyId: attorney.userId,
    });
    await post(owner, `/v1/matters/${matter.id}/parties`, {
      name: 'Landlord Limited',
      type: 'organization',
      role: 'opposing_party',
    });
    return { owner, attorney, matter, clientId: client.body.id as string };
  }
  const tpl = async (who: Parameters<typeof post>[0], body: string) =>
    (
      await post(who, '/v1/templates', {
        name: `T${Math.random().toString(36).slice(2, 8)}`,
        category: 'letter',
        body,
      })
    ).body.id as string;
  const render = (who: Parameters<typeof post>[0], id: string, body: object) =>
    post(who, `/v1/templates/${id}/render`, body);

  it('fills facts from the matter, client, court, parties and firm', async () => {
    const { owner, matter } = await setup();
    const id = await tpl(
      owner,
      'Client {{client.name}} ({{client.address}}) v {{party.opposing.name}} re {{matter.title}} {{matter.number}}. Court: {{court.name}}, no. {{court.case_number}}, {{court.jurisdiction}}, filed {{court.filed_on}}. Lead: {{attorney.name}}. Firm: {{firm.name}}. By {{author.name}} on {{today}}.',
    );
    const res = await render(owner, id, { matterId: matter.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.missing).toEqual([]);
    expect(res.body.text).toContain(
      'Client Acme Holdings LLC (1 Main St, Delhi) v Landlord Limited re Lease Dispute M-',
    );
    expect(res.body.text).toContain(
      'Court: High Court of Delhi, no. CS 12/2026, Delhi, filed 4 March 2026.',
    );
    expect(res.body.text).toContain('Lead: Test attorney.');
    expect(res.body.text).toMatch(/Firm: .*LLP\. By Olivia Owner on \d{1,2} \w+ \d{4}\./);
  });

  it('marks what it cannot fill, accepts typed values, and lets typed values win', async () => {
    const { owner, matter } = await setup();
    const id = await tpl(
      owner,
      'To {{client.name}}: pay {{amount}} by {{due.date}}. Opposing counsel: {{party.opposing_counsel.name}}.',
    );
    const res = await render(owner, id, {
      matterId: matter.id,
      values: { amount: '5,000', 'client.name': 'Acme (renamed)' },
    });
    expect(res.body.text).toBe(
      'To Acme (renamed): pay 5,000 by [MISSING: due.date]. Opposing counsel: [MISSING: party.opposing_counsel.name].',
    );
    expect(res.body.missing).toEqual(['due.date', 'party.opposing_counsel.name']);
    const byKey = Object.fromEntries(res.body.placeholders.map((p: { key: string }) => [p.key, p]));
    expect(byKey['amount']).toMatchObject({ builtin: false, value: '5,000', missing: false });
    expect(byKey['due.date']).toMatchObject({ value: null, missing: true });
    expect(byKey['client.name'].label).toBe('Client name');

    // Without a matter, only firm/user/date facts are available.
    const noMatter = await render(owner, id, { values: { amount: '1', 'due.date': 'tomorrow' } });
    expect(noMatter.body.missing).toEqual(['client.name', 'party.opposing_counsel.name']);
  });

  it('never expands placeholders inside typed values', async () => {
    const { owner } = await setup();
    const id = await tpl(owner, 'Note: {{note}} / {{client.name}}');
    const res = await render(owner, id, { values: { note: '{{client.name}} and {{firm.name}}' } });
    expect(res.body.text).toContain(
      'Note: {{client.name}} and {{firm.name}} / [MISSING: client.name]',
    );
  });

  it('refuses matters the caller cannot see, other firms, and bad input', async () => {
    const { owner, attorney, clientId } = await setup();
    const secret = await newMatter(owner, clientId, { title: 'Secret', restricted: true });
    const id = await tpl(owner, 'Re {{matter.title}}');
    expect((await render(attorney, id, { matterId: secret.id })).status).toBe(404);
    expect((await render(owner, id, { matterId: secret.id })).body.text).toBe('Re Secret');

    const other = await registerWithMfa(app, 'Other');
    expect((await render(other, id, {})).status).toBe(404);
    expect((await render(owner, id, { values: { 'Bad Key': 'x' } })).status).toBe(400);
    expect((await render(owner, id, { values: { ok: 'x'.repeat(2001) } })).status).toBe(400);
    expect((await render(owner, id, { matterId: 'nope' })).status).toBe(400);
  });

  it('fills the shipped templates from a real matter, leaving only the genuinely unknown blanks', async () => {
    const { owner, matter } = await setup();
    const list = (await owner.agent.get('/v1/templates')).body.data as T[];
    const engagement = find({ body: { data: list } }, 'Engagement letter');
    const res = await render(owner, engagement.id, {
      matterId: matter.id,
      values: { 'engagement.fee_basis': 'hourly at agreed rates' },
    });
    expect(res.body.text).toContain('Dear Acme Holdings LLC');
    expect(res.body.text).toContain('Re: Engagement — Lease Dispute');
    expect(res.body.missing).toEqual(
      expect.arrayContaining(['engagement.scope_details', 'engagement.billing_frequency']),
    );
    expect(res.body.missing).not.toContain('client.name');
    expect(res.body.text).toContain('hourly at agreed rates');
  });

  it('keeps the values you typed out of the audit log', async () => {
    const { owner, matter } = await setup();
    const id = await tpl(owner, 'Amount {{amount}}');
    await render(owner, id, { matterId: matter.id, values: { amount: 'SECRET-4,321,987' } });
    const rows = await AuditLogModel.find({
      organizationId: owner.body.organization.id,
      action: 'template.rendered',
    }).lean();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|4,321,987/);
  });
});
