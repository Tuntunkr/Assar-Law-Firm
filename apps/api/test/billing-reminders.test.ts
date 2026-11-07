import type { INestApplication } from '@nestjs/common';
import { InvoiceModel, NotificationModel } from '@assar/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bootApp,
  idemKey,
  newClient,
  newMatter,
  post,
  put,
  registerWithMfa,
  type Owner,
} from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await app.close();
});

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** An issued invoice for one hour of work at 200.00/h, due `dueInDays` from now (negative = already past due). */
async function issuedInvoice(
  owner: Owner,
  o: { matterIds?: string[]; clientId?: string; dueInDays?: number } = {},
) {
  await put(owner, '/v1/billing/settings', {
    currency: 'USD',
    defaultHourlyRateCents: 20000,
    defaultTaxRateBp: 0,
    invoiceDueDays: 30,
  });
  const clientId = o.clientId ?? (await newClient(owner));
  const matterIds = o.matterIds ?? [(await newMatter(owner, clientId)).id];
  for (const matterId of matterIds)
    await post(owner, '/v1/time-entries', {
      matterId,
      workDate: today(),
      minutes: 60,
      description: 'Work on the matter',
    });
  const inv = await post(owner, '/v1/invoices', { clientId, matterIds });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  const issued = await post(owner, `/v1/invoices/${inv.body.id}/issue`, {});
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  const id = inv.body.id as string;
  if (o.dueInDays !== undefined)
    await InvoiceModel.updateOne({ _id: id }, { dueAt: daysAgo(-o.dueInDays) });
  return { id, clientId, matterIds, number: issued.body.number as string };
}
/** Payments require an Idempotency-Key header. */
const pay = (o: Owner, id: string, amountCents: number, method = 'bank_transfer') =>
  o.agent
    .post(`/v1/invoices/${id}/payments`)
    .set('x-csrf-token', o.csrf)
    .set('idempotency-key', idemKey())
    .send({ amountCents, method });
const notificationsFor = (userId: string, id: string) =>
  NotificationModel.find({ userId, 'link.id': id }).sort({ _id: 1 }).lean();

describe('overdue invoices', () => {
  it('flags overdue invoices in the list, and filters to them', async () => {
    const o = await registerWithMfa(app);
    const late = await issuedInvoice(o, { dueInDays: -10 });
    const fine = await issuedInvoice(o, { dueInDays: 20 });
    const all = (await o.agent.get('/v1/invoices').expect(200)).body.data as {
      id: string;
      daysPastDue: number | null;
    }[];
    expect(all.find((i) => i.id === late.id)!.daysPastDue).toBe(10);
    expect(all.find((i) => i.id === fine.id)!.daysPastDue).toBe(-20);
    const only = (await o.agent.get('/v1/invoices?overdue=true').expect(200)).body.data as {
      id: string;
    }[];
    expect(only.map((i) => i.id)).toEqual([late.id]);
    expect((await o.agent.get('/v1/invoices?overdue=maybe')).status).toBe(400);
  });

  it('drafts a reminder with the amount, due date and how late it is — only for invoices that owe money', async () => {
    const o = await registerWithMfa(app);
    const inv = await issuedInvoice(o, { dueInDays: -8 });
    const d = (await o.agent.get(`/v1/invoices/${inv.id}/reminder-draft`).expect(200)).body;
    expect(d).toMatchObject({ daysPastDue: 8, step: 7 });
    expect(d.text).toContain(`invoice ${inv.number} for $200.00`);
    expect(d.text).toContain('8 days overdue');
    expect(d.text).toContain('Olivia Owner');

    expect((await pay(o, inv.id, 20000)).status).toBe(201);
    expect((await o.agent.get(`/v1/invoices/${inv.id}/reminder-draft`)).status).toBe(409); // paid
    const draft = await post(o, '/v1/invoices', { clientId: inv.clientId, matterIds: [] });
    if (draft.status === 201)
      expect((await o.agent.get(`/v1/invoices/${draft.body.id}/reminder-draft`)).status).toBe(409);
  });
});

describe('automatic reminders', () => {
  it('notifies the creator and billers once per step, never repeats, and moves on to the next step', async () => {
    const owner = await registerWithMfa(app);
    const billing = await addMember(app, owner, 'billing');
    const staff = await addMember(app, owner, 'staff');
    const inv = await issuedInvoice(owner, { dueInDays: -2 }); // step 1

    const first = await post(owner, '/v1/invoices/reminders/run', {});
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.invoices).toBeGreaterThanOrEqual(1);
    const mine = await notificationsFor(owner.body.user.id, inv.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      title: `Invoice ${inv.number} is 2 days overdue`,
      source: 'system',
      link: { type: 'invoice', id: inv.id },
    });
    expect(mine[0]!.body).toMatch(/owes \$200\.00/);
    expect(await notificationsFor(billing.userId, inv.id)).toHaveLength(1);
    expect(await notificationsFor(staff.userId, inv.id)).toHaveLength(0); // cannot edit billing

    // Running again — or every hour — creates nothing new.
    expect((await post(owner, '/v1/invoices/reminders/run', {})).body.notified).toBe(0);
    expect(await notificationsFor(owner.body.user.id, inv.id)).toHaveLength(1);

    // Later, the next step (7 days) produces exactly one more.
    await InvoiceModel.updateOne({ _id: inv.id }, { dueAt: daysAgo(9) });
    expect(
      (await post(owner, '/v1/invoices/reminders/run', {})).body.notified,
    ).toBeGreaterThanOrEqual(2);
    const after = await notificationsFor(owner.body.user.id, inv.id);
    expect(after.map((n) => n.title)).toEqual([
      `Invoice ${inv.number} is 2 days overdue`,
      `Invoice ${inv.number} is 9 days overdue`,
    ]);
  });

  it('warns before the due date and ignores invoices that are not yet at a step, paid, or voided', async () => {
    const o = await registerWithMfa(app);
    const soon = await issuedInvoice(o, { dueInDays: 2 }); // step -3
    const far = await issuedInvoice(o, { dueInDays: 20 }); // before the first step
    const paid = await issuedInvoice(o, { dueInDays: -30 });
    expect((await pay(o, paid.id, 20000, 'cash')).status).toBe(201);
    const voided = await issuedInvoice(o, { dueInDays: -30 });
    await post(o, `/v1/invoices/${voided.id}/void`, { reason: 'Raised in error' });

    await post(o, '/v1/invoices/reminders/run', {});
    expect((await notificationsFor(o.body.user.id, soon.id))[0]!.title).toBe(
      `Invoice ${soon.number} falls due in 2 days`,
    );
    for (const x of [far, paid, voided])
      expect(await notificationsFor(o.body.user.id, x.id)).toHaveLength(0);
  });

  it('uses the firm’s own reminder days', async () => {
    const o = await registerWithMfa(app);
    const inv = await issuedInvoice(o, { dueInDays: -3 });
    const settings = {
      currency: 'USD',
      defaultHourlyRateCents: 20000,
      defaultTaxRateBp: 0,
      invoiceDueDays: 30,
    };
    const saved = await put(o, '/v1/billing/settings', {
      ...settings,
      reminderDays: [10, 5, 5, 10],
    });
    expect(saved.body.reminderDays).toEqual([5, 10]); // de-duplicated and sorted
    await post(o, '/v1/invoices/reminders/run', {});
    expect(await notificationsFor(o.body.user.id, inv.id)).toHaveLength(0); // 3 days late: first step is 5

    await InvoiceModel.updateOne({ _id: inv.id }, { dueAt: daysAgo(6) });
    await post(o, '/v1/invoices/reminders/run', {});
    expect(await notificationsFor(o.body.user.id, inv.id)).toHaveLength(1);

    expect(
      (
        await put(o, '/v1/billing/settings', {
          ...settings,
          reminderDays: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        })
      ).status,
    ).toBe(400);
    expect(
      (await put(o, '/v1/billing/settings', { ...settings, reminderDays: [-31] })).status,
    ).toBe(400);
    const reset = await put(o, '/v1/billing/settings', settings);
    expect(reset.body.reminderDays).toEqual([-3, 1, 7, 14, 30]); // back to the defaults
  });

  it('does not tell anyone about an invoice that touches a matter they cannot see', async () => {
    const owner = await registerWithMfa(app);
    const billing = await addMember(app, owner, 'billing');
    const clientId = await newClient(owner);
    const open = await newMatter(owner, clientId, { title: 'Open' });
    const secret = await newMatter(owner, clientId, { title: 'Secret', restricted: true });
    const inv = await issuedInvoice(owner, {
      clientId,
      matterIds: [open.id, secret.id],
      dueInDays: -2,
    });
    await post(owner, '/v1/invoices/reminders/run', {});
    expect(await notificationsFor(owner.body.user.id, inv.id)).toHaveLength(1);
    expect(await notificationsFor(billing.userId, inv.id)).toHaveLength(0);
  });

  it('only runs for the caller’s firm and needs billing:write', async () => {
    const a = await registerWithMfa(app, 'Alpha');
    const b = await registerWithMfa(app, 'Beta');
    const inv = await issuedInvoice(a, { dueInDays: -2 });
    await post(b, '/v1/invoices/reminders/run', {});
    expect(await notificationsFor(a.body.user.id, inv.id)).toHaveLength(0);
    const attorney = await addMember(app, a, 'attorney');
    expect((await post(attorney, '/v1/invoices/reminders/run', {})).status).toBe(403);
  });
});

describe('following up with a client', () => {
  it('logs each contact with channel and note, shown on the invoice', async () => {
    const o = await registerWithMfa(app);
    const inv = await issuedInvoice(o, { dueInDays: -5 });
    const r = await post(o, `/v1/invoices/${inv.id}/reminders`, {
      channel: 'whatsapp',
      note: '$where: spoke to accounts, promised Friday',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.reminders).toHaveLength(1);
    expect(r.body.reminders[0]).toMatchObject({
      channel: 'whatsapp',
      note: '$where: spoke to accounts, promised Friday',
      by: o.body.user.id,
    });
    await post(o, `/v1/invoices/${inv.id}/reminders`, { channel: 'phone' });
    expect(
      (await o.agent.get(`/v1/invoices/${inv.id}`)).body.reminders.map(
        (x: { channel: string }) => x.channel,
      ),
    ).toEqual(['whatsapp', 'phone']);
  });

  it('validates input, refuses paid invoices and other firms, and needs billing:write', async () => {
    const o = await registerWithMfa(app);
    const attorney = await addMember(app, o, 'attorney');
    const inv = await issuedInvoice(o, { dueInDays: -5 });
    expect((await post(o, `/v1/invoices/${inv.id}/reminders`, { channel: 'pigeon' })).status).toBe(
      400,
    );
    expect(
      (
        await post(o, `/v1/invoices/${inv.id}/reminders`, {
          channel: 'email',
          note: 'x'.repeat(501),
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(attorney, `/v1/invoices/${inv.id}/reminders`, { channel: 'email' })).status,
    ).toBe(403);
    const other = await registerWithMfa(app, 'Other');
    expect(
      (await post(other, `/v1/invoices/${inv.id}/reminders`, { channel: 'email' })).status,
    ).toBe(404);
    expect((await pay(o, inv.id, 20000, 'cash')).status).toBe(201);
    expect((await post(o, `/v1/invoices/${inv.id}/reminders`, { channel: 'email' })).status).toBe(
      409,
    );
  });
});
