import type { INestApplication } from '@nestjs/common';
import { AuditLogModel, InvoiceModel, TimeEntryModel } from '@assar/database';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addMember,
  bootApp,
  del,
  idemKey,
  newClient,
  newMatter,
  patch,
  post,
  put,
  registerWithMfa,
  type Member,
  type Owner,
} from './helpers';

let app: INestApplication;
beforeAll(async () => {
  // Long-lived sessions: the aging test moves the clock months ahead.
  app = await bootApp({ SESSION_IDLE_MINUTES: '2000000', SESSION_ABSOLUTE_HOURS: '87600' });
});
afterAll(async () => {
  await app.close();
});
afterEach(() => vi.useRealTimers());

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
type Who = Member | Owner;

async function firm() {
  const owner = await registerWithMfa(app);
  const admin = await addMember(app, owner, 'admin');
  const attorney = await addMember(app, owner, 'attorney');
  const paralegal = await addMember(app, owner, 'paralegal');
  const staff = await addMember(app, owner, 'staff');
  const billing = await addMember(app, owner, 'billing');
  await put(owner, '/v1/billing/settings', {
    currency: 'USD',
    defaultHourlyRateCents: 25000,
    defaultTaxRateBp: 0,
    invoiceDueDays: 30,
  }).expect(200);
  const clientId = await newClient(owner);
  const matter = await newMatter(attorney, clientId);
  return { owner, admin, attorney, paralegal, staff, billing, clientId, matter };
}

const logTime = (who: Who, matterId: string, minutes: number, extra: object = {}) =>
  post(who, '/v1/time-entries', {
    matterId,
    workDate: today(),
    minutes,
    description: 'Reviewed documents',
    ...extra,
  });
async function entry(who: Who, matterId: string, minutes: number, extra: object = {}) {
  const r = await logTime(who, matterId, minutes, extra);
  if (r.status !== 201) throw new Error(`time entry failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string; amountCents: number; rateCents: number };
}

describe('time entries', () => {
  it('prices time exactly, snapshots the rate, and honours rate precedence', async () => {
    const { owner, attorney, paralegal, billing, matter } = await firm();
    const a = await logTime(attorney, matter.id, 90).expect(201);
    expect(a.body).toMatchObject({
      minutes: 90,
      rateCents: 25000,
      amountCents: 37500,
      currency: 'USD',
      billable: true,
      status: 'unbilled',
      userId: attorney.userId,
    });
    expect(
      (await logTime(attorney, matter.id, 7, { rateCents: undefined }).expect(201)).body
        .amountCents,
    ).toBe(2917); // 7 min @ $250 = 29.1667 -> 2917
    expect(
      (await logTime(attorney, matter.id, 60, { billable: false }).expect(201)).body.amountCents,
    ).toBe(0);

    // A person's own rate beats the firm default - for new entries only.
    await put(billing, `/v1/billing/members/${paralegal.userId}/rate`, {
      hourlyRateCents: 10000,
    }).expect(200);
    expect((await logTime(paralegal, matter.id, 30).expect(201)).body).toMatchObject({
      rateCents: 10000,
      amountCents: 5000,
    });
    await put(billing, `/v1/billing/members/${attorney.userId}/rate`, {
      hourlyRateCents: 40000,
    }).expect(200);
    expect((await logTime(attorney, matter.id, 60).expect(201)).body.rateCents).toBe(40000);
    expect(
      (await attorney.agent.get(`/v1/time-entries/${a.body.id}`).expect(200)).body.rateCents,
    ).toBe(25000); // history is not rewritten

    // Only billing managers may price an entry by hand.
    expect((await logTime(attorney, matter.id, 10, { rateCents: 1 })).status).toBe(403);
    expect(
      (await logTime(owner, matter.id, 60, { rateCents: 50000 }).expect(201)).body.amountCents,
    ).toBe(50000);
  });

  it('refuses to bill without a configured rate, and validates input', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const matter = await newMatter(attorney, await newClient(owner));
    const noRate = await logTime(attorney, matter.id, 30);
    expect(noRate.status).toBe(400);
    expect(noRate.body.error.message).toMatch(/No hourly rate/);
    expect(
      (await logTime(attorney, matter.id, 30, { billable: false }).expect(201)).body.amountCents,
    ).toBe(0);

    await put(owner, '/v1/billing/settings', {
      currency: 'USD',
      defaultHourlyRateCents: 20000,
      defaultTaxRateBp: 0,
      invoiceDueDays: 30,
    }).expect(200);
    for (const bad of [
      { minutes: 0 },
      { minutes: 1441 },
      { minutes: 1.5 },
      { description: 'x' },
      { workDate: '2026-02-30' },
      { workDate: 'yesterday' },
      { workDate: daysAhead(5) },
      { rateCents: -1 },
    ]) {
      expect((await logTime(attorney, matter.id, 30, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('shows people their own time, and billing managers everyone’s', async () => {
    const { attorney, paralegal, billing, staff, matter } = await firm();
    const mine = await entry(attorney, matter.id, 30);
    const theirs = await entry(paralegal, matter.id, 45);

    expect(
      (await attorney.agent.get('/v1/time-entries').expect(200)).body.data.map(
        (e: { id: string }) => e.id,
      ),
    ).toEqual([mine.id]);
    expect((await attorney.agent.get(`/v1/time-entries/${theirs.id}`)).status).toBe(404);
    expect((await attorney.agent.get(`/v1/time-entries?userId=${paralegal.userId}`)).status).toBe(
      403,
    );
    expect((await billing.agent.get('/v1/time-entries').expect(200)).body.data).toHaveLength(2);
    expect((await billing.agent.get(`/v1/time-entries/${theirs.id}`).expect(200)).body.id).toBe(
      theirs.id,
    );
    expect(
      (await billing.agent.get(`/v1/time-entries?userId=${paralegal.userId}`).expect(200)).body
        .data,
    ).toHaveLength(1);
    expect((await logTime(staff, matter.id, 10)).status).toBe(403); // no time:write
  });

  it('lets people change their own unbilled entries, recomputing the amount', async () => {
    const { attorney, paralegal, billing, matter } = await firm();
    const e = await entry(attorney, matter.id, 60);
    const up = await patch(attorney, `/v1/time-entries/${e.id}`, {
      minutes: 90,
      description: 'Longer review',
    }).expect(200);
    expect(up.body).toMatchObject({
      minutes: 90,
      amountCents: 37500,
      description: 'Longer review',
    });
    expect(
      (await patch(attorney, `/v1/time-entries/${e.id}`, { billable: false }).expect(200)).body
        .amountCents,
    ).toBe(0);
    expect(
      (await patch(attorney, `/v1/time-entries/${e.id}`, { billable: true }).expect(200)).body
        .amountCents,
    ).toBe(37500);
    expect((await patch(paralegal, `/v1/time-entries/${e.id}`, { minutes: 5 })).status).toBe(404); // someone else's
    expect((await patch(attorney, `/v1/time-entries/${e.id}`, { rateCents: 1 })).status).toBe(403);
    expect(
      (await patch(billing, `/v1/time-entries/${e.id}`, { minutes: 30 }).expect(200)).body
        .amountCents,
    ).toBe(12500); // billing managers may correct it

    expect((await del(paralegal, `/v1/time-entries/${e.id}`)).status).toBe(404);
    await del(attorney, `/v1/time-entries/${e.id}`).expect(204);
    expect((await attorney.agent.get(`/v1/time-entries/${e.id}`)).status).toBe(404);
  });

  it('paginates and filters', async () => {
    const { attorney, matter } = await firm();
    for (let i = 0; i < 3; i++) await entry(attorney, matter.id, 10 + i, { workDate: daysAgo(i) });
    const p1 = await attorney.agent.get('/v1/time-entries?limit=2').expect(200);
    const p2 = await attorney.agent
      .get(`/v1/time-entries?limit=2&cursor=${p1.body.page.nextCursor}`)
      .expect(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p2.body.data).toHaveLength(1);
    expect(
      (await attorney.agent.get(`/v1/time-entries?from=${daysAgo(1)}&to=${today()}`).expect(200))
        .body.data,
    ).toHaveLength(1);
    expect(
      (await attorney.agent.get('/v1/time-entries?billable=false').expect(200)).body.data,
    ).toHaveLength(0);
  });

  it('keeps work descriptions out of the audit log', async () => {
    const { owner, attorney, matter } = await firm();
    await entry(attorney, matter.id, 20, {
      description: 'Confidential strategy call about the merger',
    });
    const rows = await AuditLogModel.find({
      organizationId: owner.body.organization.id,
      action: /^time\./,
    }).lean();
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/merger|strategy/);
  });
});

describe('invoices', () => {
  async function billed() {
    const f = await firm();
    const e1 = await entry(f.attorney, f.matter.id, 90); // 37500
    const e2 = await entry(f.attorney, f.matter.id, 45); // 18750
    return { ...f, e1, e2 };
  }
  const create = (who: Who, body: object, key?: string) =>
    key
      ? who.agent
          .post('/v1/invoices')
          .set('x-csrf-token', who.csrf)
          .set('idempotency-key', key)
          .send(body)
      : post(who, '/v1/invoices', body);

  it('bills time exactly: totals, tax and the claimed entries', async () => {
    const { billing, attorney, clientId, matter, e1, e2 } = await billed();
    const inv = await create(billing, { clientId, matterIds: [matter.id], taxRateBp: 825 }).expect(
      201,
    );
    expect(inv.body).toMatchObject({
      status: 'draft',
      number: null,
      currency: 'USD',
      subtotalCents: 56250,
      taxCents: 4641,
      totalCents: 60891,
      balanceCents: 0,
    });
    expect(
      inv.body.lines
        .map((l: { timeEntryId: string; amountCents: number }) => [l.timeEntryId, l.amountCents])
        .sort(),
    ).toEqual(
      [
        [e1.id, 37500],
        [e2.id, 18750],
      ].sort(),
    );
    expect(inv.body.lines[0]).toMatchObject({
      type: 'time',
      matterId: matter.id,
      rateCents: 25000,
    });

    // The time is now spoken for.
    const claimed = (await attorney.agent.get(`/v1/time-entries/${e1.id}`).expect(200)).body;
    expect(claimed).toMatchObject({ status: 'invoiced', invoiceId: inv.body.id });
    expect((await patch(attorney, `/v1/time-entries/${e1.id}`, { minutes: 5 })).status).toBe(409);
    expect((await del(attorney, `/v1/time-entries/${e1.id}`)).status).toBe(409);
    // ...and cannot be billed twice.
    expect((await create(billing, { clientId, timeEntryIds: [e1.id] })).status).toBe(409);
    expect(
      (await create(billing, { clientId, matterIds: [matter.id] }).expect(201)).body.lines,
    ).toHaveLength(0); // nothing left to bill
  });

  it('ignores client-supplied totals: the server computes every number', async () => {
    const { billing, clientId, matter } = await billed();
    const inv = await create(billing, {
      clientId,
      matterIds: [matter.id],
      totalCents: 1,
      subtotalCents: 1,
      taxCents: 1,
      lines: [{ amountCents: 1 }],
    }).expect(201);
    expect(inv.body.totalCents).toBe(56250);
  });

  it('never lets two invoices claim the same time, even at the same instant', async () => {
    const { billing, owner, clientId, matter, e1, e2 } = await billed();
    const results = await Promise.all([
      create(billing, { clientId, timeEntryIds: [e1.id, e2.id] }),
      create(owner, { clientId, timeEntryIds: [e1.id, e2.id] }),
      create(billing, { clientId, timeEntryIds: [e1.id, e2.id] }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    const winner = results.find((r) => r.status === 201)!.body.id;
    const rows = await TimeEntryModel.find({ _id: { $in: [e1.id, e2.id] } }).lean();
    expect(rows.every((r) => String(r.invoiceId) === winner && r.status === 'invoiced')).toBe(true);
    // The losers left no half-built draft behind.
    expect(
      await InvoiceModel.countDocuments({
        organizationId: owner.body.organization.id,
        'lines.timeEntryId': e1.id,
      }),
    ).toBe(1);
    expect(matter.id).toBeTruthy();
  });

  it('builds a draft with expenses and discounts, and frees time when a line is removed', async () => {
    const { billing, attorney, clientId, matter, e1 } = await billed();
    const inv = (
      await create(billing, { clientId, matterIds: [matter.id], taxRateBp: 825 }).expect(201)
    ).body;
    const withExpense = await post(billing, `/v1/invoices/${inv.id}/lines`, {
      type: 'expense',
      description: 'Court filing fee',
      amountCents: 12345,
    }).expect(201);
    expect(withExpense.body).toMatchObject({
      subtotalCents: 68595,
      taxCents: 5659,
      totalCents: 74254,
    });
    const withDiscount = await post(billing, `/v1/invoices/${inv.id}/lines`, {
      type: 'adjustment',
      description: 'Courtesy discount',
      amountCents: -5000,
    }).expect(201);
    expect(withDiscount.body).toMatchObject({
      subtotalCents: 63595,
      taxCents: 5247,
      totalCents: 68842,
    });

    for (const bad of [
      { type: 'expense', amountCents: -5 },
      { type: 'expense', amountCents: 0 },
      { type: 'adjustment', amountCents: 0 },
      { type: 'expense', amountCents: 1.5 },
      { type: 'time', amountCents: 5 },
      { type: 'expense', amountCents: 1e12 },
    ]) {
      expect(
        (await post(billing, `/v1/invoices/${inv.id}/lines`, { description: 'Bad line', ...bad }))
          .status,
        JSON.stringify(bad),
      ).toBe(400);
    }

    const timeLine = withDiscount.body.lines.find(
      (l: { timeEntryId: string | null }) => l.timeEntryId === e1.id,
    );
    const afterRemove = await billing.agent
      .delete(`/v1/invoices/${inv.id}/lines/${timeLine.id}`)
      .set('x-csrf-token', billing.csrf)
      .expect(200);
    expect(afterRemove.body.subtotalCents).toBe(63595 - 37500);
    expect((await attorney.agent.get(`/v1/time-entries/${e1.id}`).expect(200)).body).toMatchObject({
      status: 'unbilled',
      invoiceId: null,
    }); // billable again

    await put(billing, `/v1/invoices/${inv.id}`, {}).catch(() => undefined);
    const patched = await patch(billing, `/v1/invoices/${inv.id}`, {
      taxRateBp: 0,
      dueDays: 14,
      notes: 'Thank you',
    }).expect(200);
    expect(patched.body).toMatchObject({
      taxCents: 0,
      dueDays: 14,
      notes: 'Thank you',
      totalCents: patched.body.subtotalCents,
    });
    expect((await patch(billing, `/v1/invoices/${inv.id}`, {})).status).toBe(400);
  });

  it('deleting a draft releases all of its time', async () => {
    const { billing, attorney, clientId, matter, e1, e2 } = await billed();
    const inv = (await create(billing, { clientId, matterIds: [matter.id] }).expect(201)).body;
    await del(billing, `/v1/invoices/${inv.id}`).expect(204);
    expect((await billing.agent.get(`/v1/invoices/${inv.id}`)).status).toBe(404);
    for (const e of [e1, e2])
      expect((await attorney.agent.get(`/v1/time-entries/${e.id}`).expect(200)).body.status).toBe(
        'unbilled',
      );
  });

  it('numbers invoices sequentially at issue (no gaps, even when issued concurrently) and then freezes them', async () => {
    const { billing, owner, clientId, matter } = await billed();
    const drafts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = (await create(billing, { clientId }).expect(201)).body;
      await post(billing, `/v1/invoices/${d.id}/lines`, {
        type: 'expense',
        description: `Expense ${i}`,
        amountCents: 1000 + i,
      }).expect(201);
      drafts.push(d.id);
    }
    expect(
      (
        await create(billing, { clientId }).then((r) =>
          post(billing, `/v1/invoices/${r.body.id}/issue`, {}),
        )
      ).status,
    ).toBe(400); // empty invoice

    const issued = await Promise.all(
      drafts.map((id) => post(billing, `/v1/invoices/${id}/issue`, {})),
    );
    expect(issued.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const numbers = issued.map((r) => r.body.number as string).sort();
    expect(numbers).toEqual(
      [1, 2, 3, 4, 5].map((n) => `INV-${new Date().getUTCFullYear()}-0000${n}`),
    );
    expect(issued[0]!.body).toMatchObject({
      status: 'issued',
      balanceCents: issued[0]!.body.totalCents,
      dueAt: expect.any(String),
    });

    const id = drafts[0]!;
    expect((await post(billing, `/v1/invoices/${id}/issue`, {})).status).toBe(409); // already issued
    expect((await patch(billing, `/v1/invoices/${id}`, { notes: 'x' })).status).toBe(409);
    expect(
      (
        await post(billing, `/v1/invoices/${id}/lines`, {
          type: 'expense',
          description: 'Late addition',
          amountCents: 5,
        })
      ).status,
    ).toBe(409);
    expect((await del(billing, `/v1/invoices/${id}`)).status).toBe(409);

    // Zero or negative totals are not invoices.
    const neg = (await create(billing, { clientId }).expect(201)).body;
    await post(billing, `/v1/invoices/${neg.id}/lines`, {
      type: 'expense',
      description: 'Small expense',
      amountCents: 100,
    }).expect(201);
    await post(billing, `/v1/invoices/${neg.id}/lines`, {
      type: 'adjustment',
      description: 'Big discount',
      amountCents: -500,
    }).expect(201);
    expect((await post(billing, `/v1/invoices/${neg.id}/issue`, {})).status).toBe(400);
    expect(owner).toBeTruthy();
    expect(matter).toBeTruthy();
  });
});

describe('payments & voiding', () => {
  async function issued(totalExpenseCents = 100_000) {
    const f = await firm();
    const d = (await post(f.billing, '/v1/invoices', { clientId: f.clientId }).expect(201)).body;
    await post(f.billing, `/v1/invoices/${d.id}/lines`, {
      type: 'expense',
      description: 'Retainer',
      amountCents: totalExpenseCents,
    }).expect(201);
    const inv = (await post(f.billing, `/v1/invoices/${d.id}/issue`, {}).expect(200)).body;
    return { ...f, inv };
  }
  const pay = (who: Who, id: string, body: object, key: string | null = idemKey()) => {
    const r = who.agent.post(`/v1/invoices/${id}/payments`).set('x-csrf-token', who.csrf);
    return (key ? r.set('idempotency-key', key) : r).send({ method: 'bank_transfer', ...body });
  };

  it('records partial and final payments and flips to paid', async () => {
    const { billing, inv } = await issued();
    const p1 = await pay(billing, inv.id, { amountCents: 30000, reference: 'WIRE-1' }).expect(201);
    expect(p1.body).toMatchObject({
      status: 'issued',
      amountPaidCents: 30000,
      balanceCents: 70000,
    });
    expect(p1.body.payments).toHaveLength(1);
    const p2 = await pay(billing, inv.id, { amountCents: 70000, method: 'card' }).expect(201);
    expect(p2.body).toMatchObject({
      status: 'paid',
      amountPaidCents: 100000,
      balanceCents: 0,
      paidAt: expect.any(String),
    });
    expect((await pay(billing, inv.id, { amountCents: 1 })).status).toBe(409); // fully paid
  });

  it('rejects overpayment, bad amounts, future dates and payments on drafts', async () => {
    const { billing, clientId, inv } = await issued();
    expect((await pay(billing, inv.id, { amountCents: 100001 })).status).toBe(409);
    for (const bad of [
      { amountCents: 0 },
      { amountCents: -5 },
      { amountCents: 10.5 },
      { amountCents: 1e12 },
      { method: 'bitcoin', amountCents: 5 },
      { amountCents: 5, paidAt: new Date(Date.now() + 10 * 86_400_000).toISOString() },
    ]) {
      expect((await pay(billing, inv.id, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const draft = (await post(billing, '/v1/invoices', { clientId }).expect(201)).body;
    expect((await pay(billing, draft.id, { amountCents: 5 })).status).toBe(409);
    expect(
      (await billing.agent.get(`/v1/invoices/${inv.id}`).expect(200)).body.amountPaidCents,
    ).toBe(0); // nothing leaked in
  });

  it('requires an Idempotency-Key and counts a retried payment only once', async () => {
    const { billing, inv } = await issued();
    expect((await pay(billing, inv.id, { amountCents: 100 }, null)).status).toBe(400);
    const key = idemKey();
    const first = await pay(billing, inv.id, { amountCents: 25000 }, key).expect(201);
    const retry = await pay(billing, inv.id, { amountCents: 25000 }, key).expect(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.payments).toHaveLength(1);
    expect(first.body.balanceCents).toBe(75000);
    expect(
      (await billing.agent.get(`/v1/invoices/${inv.id}`).expect(200)).body.amountPaidCents,
    ).toBe(25000);
    expect((await pay(billing, inv.id, { amountCents: 26000 }, key)).status).toBe(422); // same key, different request
  });

  it('can never be overpaid, even by simultaneous payments', async () => {
    const { billing, owner, inv } = await issued(100_000);
    const results = await Promise.all([
      pay(billing, inv.id, { amountCents: 60000 }),
      pay(owner, inv.id, { amountCents: 60000 }),
      pay(billing, inv.id, { amountCents: 60000 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const final = (await billing.agent.get(`/v1/invoices/${inv.id}`).expect(200)).body;
    expect(final).toMatchObject({ amountPaidCents: 60000, balanceCents: 40000, status: 'issued' });
    expect(final.payments).toHaveLength(1);
  });

  it('voids an unpaid invoice, freeing its time, and refuses once money has moved', async () => {
    const { billing, attorney, clientId, matter } = await firm();
    const e = await entry(attorney, matter.id, 60);
    const d = (
      await post(billing, '/v1/invoices', { clientId, matterIds: [matter.id] }).expect(201)
    ).body;
    expect(
      (await post(billing, `/v1/invoices/${d.id}/void`, { reason: 'Wrong client' })).status,
    ).toBe(409); // drafts are deleted, not voided
    await post(billing, `/v1/invoices/${d.id}/issue`, {}).expect(200);
    expect((await post(billing, `/v1/invoices/${d.id}/void`, {})).status).toBe(400); // a reason is required
    const v = await post(billing, `/v1/invoices/${d.id}/void`, {
      reason: 'Issued in error',
    }).expect(200);
    expect(v.body).toMatchObject({
      status: 'void',
      balanceCents: 0,
      voidReason: 'Issued in error',
    });
    expect((await attorney.agent.get(`/v1/time-entries/${e.id}`).expect(200)).body.status).toBe(
      'unbilled',
    );
    expect((await post(billing, `/v1/invoices/${d.id}/void`, { reason: 'Again' })).status).toBe(
      409,
    );
    expect(
      (await post(billing, '/v1/invoices', { clientId, timeEntryIds: [e.id] }).expect(201)).body
        .lines,
    ).toHaveLength(1); // billable again

    const paid = await issued();
    await pay(paid.billing, paid.inv.id, { amountCents: 100 }).expect(201);
    expect(
      (await post(paid.billing, `/v1/invoices/${paid.inv.id}/void`, { reason: 'Too late' })).status,
    ).toBe(409);
  });
});

describe('permissions, isolation & restricted matters', () => {
  it('limits who can read and who can change billing data', async () => {
    const { owner, admin, attorney, paralegal, staff, billing, clientId } = await firm();
    const inv = (await post(billing, '/v1/invoices', { clientId }).expect(201)).body;
    for (const who of [attorney, paralegal, staff]) {
      expect((await who.agent.get('/v1/invoices')).status).toBe(403);
      expect((await who.agent.get(`/v1/invoices/${inv.id}`)).status).toBe(403);
      expect((await post(who, '/v1/invoices', { clientId })).status).toBe(403);
      expect((await who.agent.get('/v1/reports/billing/aging')).status).toBe(403);
      expect((await who.agent.get('/v1/billing/settings')).status).toBe(403);
      expect(
        (
          await put(who, '/v1/billing/settings', {
            currency: 'USD',
            defaultHourlyRateCents: 1,
            defaultTaxRateBp: 0,
            invoiceDueDays: 1,
          })
        ).status,
      ).toBe(403);
    }
    expect((await admin.agent.get('/v1/invoices').expect(200)).body.data).toHaveLength(1); // read-only
    expect((await post(admin, '/v1/invoices', { clientId })).status).toBe(403);
    expect((await post(owner, '/v1/invoices', { clientId }).expect(201)).body.status).toBe('draft');
  });

  it('keeps firms completely apart', async () => {
    const a = await firm();
    const b = await firm();
    const e = await entry(a.attorney, a.matter.id, 60);
    const inv = (
      await post(a.billing, '/v1/invoices', {
        clientId: a.clientId,
        matterIds: [a.matter.id],
      }).expect(201)
    ).body;
    await post(a.billing, `/v1/invoices/${inv.id}/issue`, {}).expect(200);

    expect((await b.billing.agent.get(`/v1/invoices/${inv.id}`)).status).toBe(404);
    expect((await post(b.billing, `/v1/invoices/${inv.id}/issue`, {})).status).toBe(404);
    expect(
      (await post(b.billing, `/v1/invoices/${inv.id}/void`, { reason: 'Hijack' })).status,
    ).toBe(404);
    expect(
      (
        await b.billing.agent
          .post(`/v1/invoices/${inv.id}/payments`)
          .set('x-csrf-token', b.billing.csrf)
          .set('idempotency-key', idemKey())
          .send({ amountCents: 5, method: 'cash' })
      ).status,
    ).toBe(404);
    expect((await b.billing.agent.get('/v1/invoices').expect(200)).body.data).toHaveLength(0);
    expect((await b.attorney.agent.get(`/v1/time-entries/${e.id}`)).status).toBe(404);
    expect((await patch(b.billing, `/v1/time-entries/${e.id}`, { minutes: 1 })).status).toBe(404);
    expect((await post(b.billing, '/v1/invoices', { clientId: a.clientId })).status).toBe(404); // someone else's client
    expect(
      (await post(b.billing, '/v1/invoices', { clientId: b.clientId, timeEntryIds: [e.id] }))
        .status,
    ).toBe(404);
    expect((await logTime(b.attorney, a.matter.id, 30)).status).toBe(404);
    expect(
      (
        await put(b.billing, `/v1/billing/members/${a.attorney.userId}/rate`, {
          hourlyRateCents: 1,
        })
      ).status,
    ).toBe(404);
    const rpt = (
      await b.billing.agent
        .get(`/v1/reports/time?from=${daysAgo(30)}&to=${daysAhead(2)}`)
        .expect(200)
    ).body;
    expect(rpt.rows).toEqual([]);
    expect(
      (
        await b.billing.agent
          .get(`/v1/reports/billing/summary?from=${daysAgo(30)}&to=${daysAhead(2)}`)
          .expect(200)
      ).body,
    ).toMatchObject({ invoicedCents: 0, unbilledCents: 0 });
  });

  it('hides time and invoices on restricted matters from billing staff without access', async () => {
    const { owner, billing, attorney, clientId, matter } = await firm();
    const walled = await newMatter(attorney, clientId, {
      title: 'Walled matter',
      restricted: true,
    });
    const open = await entry(attorney, matter.id, 60);
    const secret = await entry(attorney, walled.id, 120);

    const ids = (r: { body: { data: { id: string }[] } }) => r.body.data.map((x) => x.id);
    expect(ids(await billing.agent.get('/v1/time-entries').expect(200))).toEqual([open.id]);
    expect((await billing.agent.get(`/v1/time-entries/${secret.id}`)).status).toBe(404);
    expect((await post(billing, '/v1/invoices', { clientId, matterIds: [walled.id] })).status).toBe(
      404,
    );
    expect(
      (await post(billing, '/v1/invoices', { clientId, timeEntryIds: [secret.id] })).status,
    ).toBe(404);
    expect(ids(await owner.agent.get('/v1/time-entries').expect(200))).toContain(secret.id); // the owner has audited break-glass access

    // An invoice that includes a walled matter is invisible to anyone who can't see that matter.
    const inv = (
      await post(owner, '/v1/invoices', { clientId, matterIds: [walled.id, matter.id] }).expect(201)
    ).body;
    expect((await billing.agent.get(`/v1/invoices/${inv.id}`)).status).toBe(404);
    expect((await post(billing, `/v1/invoices/${inv.id}/issue`, {})).status).toBe(404);
    expect(ids(await billing.agent.get('/v1/invoices').expect(200))).not.toContain(inv.id);
    expect(ids(await owner.agent.get('/v1/invoices').expect(200))).toContain(inv.id);
    expect(
      (await owner.agent.get(`/v1/time-entries?matterId=${walled.id}`).expect(200)).body.data,
    ).toHaveLength(1);
    expect((await billing.agent.get(`/v1/time-entries?matterId=${walled.id}`)).status).toBe(404);
  });

  it('allows the currency to change only before any money exists', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const settings = (currency: string) =>
      put(owner, '/v1/billing/settings', {
        currency,
        defaultHourlyRateCents: 20000,
        defaultTaxRateBp: 825,
        invoiceDueDays: 14,
      });
    expect((await settings('EUR')).status).toBe(200);
    expect((await settings('XXX')).status).toBe(400);
    expect(
      (
        await put(owner, '/v1/billing/settings', {
          currency: 'EUR',
          defaultHourlyRateCents: 1.5,
          defaultTaxRateBp: 0,
          invoiceDueDays: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put(owner, '/v1/billing/settings', {
          currency: 'EUR',
          defaultHourlyRateCents: 100,
          defaultTaxRateBp: 10001,
          invoiceDueDays: 1,
        })
      ).status,
    ).toBe(400);
    const matter = await newMatter(attorney, await newClient(owner));
    await entry(attorney, matter.id, 30);
    const blocked = await settings('GBP');
    expect(blocked.status).toBe(409);
    expect((await settings('EUR')).status).toBe(200); // same currency stays editable
    expect((await owner.agent.get('/v1/billing/settings').expect(200)).body).toMatchObject({
      currency: 'EUR',
      defaultTaxRateBp: 825,
      invoiceDueDays: 14,
    });
  });
});

describe('reports', () => {
  async function ledger() {
    const f = await firm();
    await put(f.owner, `/v1/billing/members/${f.paralegal.userId}`, {}).catch(() => undefined);
    await put(f.billing, `/v1/billing/members/${f.paralegal.userId}/rate`, {
      hourlyRateCents: 10000,
    }).expect(200);
    const secondClient = await newClient(f.owner, 'Second Client LLC');
    const m2 = await newMatter(f.attorney, secondClient);
    await entry(f.attorney, f.matter.id, 120); // 50000
    await entry(f.paralegal, f.matter.id, 60); // 10000
    await entry(f.attorney, m2.id, 30); // 12500
    await entry(f.attorney, f.matter.id, 60, { billable: false });
    return { ...f, secondClient, m2 };
  }
  const range = () => `from=${daysAgo(30)}&to=${daysAhead(2)}`;

  it('totals time by person, matter and client, with billable vs unbilled money', async () => {
    const { billing, attorney, paralegal, matter, m2, clientId, secondClient } = await ledger();
    const byUser = (await billing.agent.get(`/v1/reports/time?${range()}&groupBy=user`).expect(200))
      .body.rows;
    expect(byUser.find((r: { key: string }) => r.key === attorney.userId)).toMatchObject({
      entries: 3,
      hours: 3.5,
      billableHours: 2.5,
      billableAmountCents: 62500,
      unbilledAmountCents: 62500,
    });
    expect(byUser.find((r: { key: string }) => r.key === paralegal.userId)).toMatchObject({
      hours: 1,
      billableAmountCents: 10000,
      label: expect.any(String),
    });
    const byMatter = (
      await billing.agent.get(`/v1/reports/time?${range()}&groupBy=matter`).expect(200)
    ).body.rows;
    expect(byMatter.find((r: { key: string }) => r.key === matter.id)).toMatchObject({
      billableAmountCents: 60000,
      label: expect.stringContaining('Sample Matter'),
    });
    expect(byMatter.find((r: { key: string }) => r.key === m2.id).billableAmountCents).toBe(12500);
    const byClient = (
      await billing.agent.get(`/v1/reports/time?${range()}&groupBy=client`).expect(200)
    ).body.rows;
    expect(byClient.map((r: { key: string }) => r.key).sort()).toEqual(
      [clientId, secondClient].sort(),
    );
    expect(
      (
        await billing.agent
          .get(`/v1/reports/time?${range()}&userId=${paralegal.userId}`)
          .expect(200)
      ).body.rows,
    ).toHaveLength(1);
  });

  it('validates the date range', async () => {
    const { billing } = await ledger();
    for (const q of [
      '',
      `from=${daysAgo(1)}`,
      `from=${today()}&to=${daysAgo(3)}`,
      `from=${daysAgo(400)}&to=${today()}`,
      'from=2026-13-01&to=2026-14-01',
      `${range()}&groupBy=weather`,
    ]) {
      expect((await billing.agent.get(`/v1/reports/time?${q}`)).status, q).toBe(400);
    }
    expect(
      (await billing.agent.get(`/v1/reports/billing/summary?${range()}`).expect(200)).body,
    ).toHaveProperty('unbilledCents');
  });

  it('summarises billing: unbilled work, invoiced, collected, outstanding', async () => {
    const { billing, clientId, matter } = await ledger();
    const before = (await billing.agent.get(`/v1/reports/billing/summary?${range()}`).expect(200))
      .body;
    expect(before).toMatchObject({
      unbilledCents: 72500,
      unbilledHours: 3.5,
      invoicedCents: 0,
      outstandingCents: 0,
    }); // 60000 + 12500 (non-billable excluded)

    const d = (
      await post(billing, '/v1/invoices', { clientId, matterIds: [matter.id] }).expect(201)
    ).body; // 60000
    await post(billing, `/v1/invoices/${d.id}/issue`, {}).expect(200);
    await billing.agent
      .post(`/v1/invoices/${d.id}/payments`)
      .set('x-csrf-token', billing.csrf)
      .set('idempotency-key', idemKey())
      .send({ amountCents: 25000, method: 'check' })
      .expect(201);
    const after = (await billing.agent.get(`/v1/reports/billing/summary?${range()}`).expect(200))
      .body;
    expect(after).toMatchObject({
      unbilledCents: 12500,
      invoicedCents: 60000,
      invoicesIssued: 1,
      collectedCents: 25000,
      paymentsReceived: 1,
      outstandingCents: 35000,
      openInvoices: 1,
      overdueCents: 0,
    });

    // Not yet due, then overdue, then deeply overdue.
    const aging = async () =>
      (await billing.agent.get('/v1/reports/billing/aging').expect(200)).body;
    expect((await aging()).buckets.notYetDue).toEqual({ count: 1, cents: 35000 });
    // The invoice is due 30 days after issue. Move the clock forward and watch it age through the buckets.
    vi.useFakeTimers({ toFake: ['Date'] });
    const lateBy = async (daysLate: number, bucket: string) => {
      vi.setSystemTime(Date.now() + daysLate * 86_400_000);
      const b = (await aging()).buckets as Record<string, { count: number; cents: number }>;
      expect(b[bucket], `${bucket} at ${daysLate} days`).toEqual({ count: 1, cents: 35000 });
      expect(Object.values(b).reduce((n, x) => n + x.count, 0)).toBe(1); // in exactly one bucket
    };
    await lateBy(40, 'days1to30'); // 10 days late
    expect(
      (
        await billing.agent
          .get(`/v1/reports/billing/summary?from=${daysAgo(30)}&to=${daysAhead(2)}`)
          .expect(200)
      ).body.overdueCents,
    ).toBe(35000);
    await lateBy(25, 'days31to60'); // 35 days late
    await lateBy(30, 'days61to90'); // 65 days late
    await lateBy(30, 'over90'); // 95 days late
  });

  it('leaves out restricted matters the viewer cannot see', async () => {
    const { owner, billing, attorney, clientId } = await ledger();
    const walled = await newMatter(attorney, clientId, { restricted: true });
    await entry(attorney, walled.id, 600); // 250000 of walled time
    const seen = (await billing.agent.get(`/v1/reports/time?${range()}&groupBy=matter`).expect(200))
      .body;
    expect(seen.restrictedMattersExcluded).toBe(true);
    expect(seen.rows.some((r: { key: string }) => r.key === walled.id)).toBe(false);
    expect(
      (await billing.agent.get(`/v1/reports/billing/summary?${range()}`).expect(200)).body
        .unbilledCents,
    ).toBe(72500);
    expect(
      (await owner.agent.get(`/v1/reports/billing/summary?${range()}`).expect(200)).body
        .unbilledCents,
    ).toBe(72500 + 250000);
  });

  it('exports CSV that is safe to open in a spreadsheet, and audits the export', async () => {
    const { owner, billing, attorney, matter, paralegal } = await ledger();
    const evil = [
      '=HYPERLINK("http://evil.example","click")',
      '+1+1',
      '-2+3',
      '@SUM(A1)',
      'Plain, with comma and "quotes"',
      'line one\nline two',
    ];
    for (const d of evil) await entry(attorney, matter.id, 10, { description: d });

    const res = await billing.agent.get(`/v1/reports/time/export?${range()}`).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="time-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const text = res.text;
    expect(text.startsWith('﻿"Date"') || text.startsWith('﻿Date')).toBe(true);
    expect(text.split('\r\n')[0]).toContain('Description');
    // No cell begins with a formula character; dangerous ones are neutralised with a leading apostrophe.
    const cells = text
      .replace(/"(?:[^"]|"")*"|[^,\r\n]+/g, (m) => `\u0000${m}`)
      .split('\u0000')
      .map((c) => c.replace(/^"/, ''));
    expect(cells.filter((c) => /^[=+\-@]/.test(c))).toEqual([]);
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(text).toContain(`"'+1+1"`);
    expect(text).toContain(`"'-2+3"`);
    expect(text).toContain(`"'@SUM(A1)"`);
    expect(text).toContain('"Plain, with comma and ""quotes"""');
    expect(text).toContain('line one line two'); // line breaks flattened
    expect(text).toContain(',yes,');

    expect((await attorney.agent.get(`/v1/reports/time/export?${range()}`)).status).toBe(403);
    expect((await paralegal.agent.get(`/v1/reports/time/export?${range()}`)).status).toBe(403);
    const audit = (await owner.agent.get('/v1/audit-logs?action=report.time_exported').expect(200))
      .body.data;
    expect(audit).toHaveLength(1);
    expect(audit[0].meta.rows).toBeGreaterThan(5);
    expect(JSON.stringify(audit)).not.toMatch(/HYPERLINK|SUM/);
  });
});
