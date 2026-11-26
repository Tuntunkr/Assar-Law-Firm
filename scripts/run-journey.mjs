/**
 * Drives one synthetic matter through the live API. Prints statuses only.
 * Does not print passwords, tokens, or authenticator secrets.
 */
import { createHmac } from 'node:crypto';
import { readFileSync as readText, writeFileSync as writeText } from 'node:fs';
import { resolve } from 'node:path';

const API = process.env.ASSAR_API_URL ?? 'http://127.0.0.1:4000';
const root = resolve(import.meta.dirname, '..');
const login = readText(resolve(root, '.data/demo-login.txt'), 'utf8');
const grab = (label) => {
  const line = login.split('\n').find((l) => l.startsWith(label));
  if (!line) throw new Error(`missing ${label}`);
  return line.slice(label.length).trim();
};
const password = grab('Shared synthetic password:');
const ownerEmail = grab('Owner email:');
const ownerSecret = grab('Owner authenticator secret:');
const billingSecret = grab('Billing authenticator secret:');
const slug = grab('Slug:');

const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const decodeBase32 = (input) => {
  let bits = '';
  for (const c of input.replace(/=+$/u, '').toUpperCase()) {
    const v = ALPH.indexOf(c);
    if (v < 0) throw new Error('bad secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};
const totp = (secret) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac('sha1', decodeBase32(secret)).update(buf).digest();
  const offset = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
};

class Session {
  constructor() {
    this.jar = new Map();
    this.csrf = '';
  }
  async call(method, path, body, extra = {}) {
    const headers = { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const pair = line.split(';', 1)[0];
      const i = pair.indexOf('=');
      if (i > 0) this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    const payload = text ? JSON.parse(text) : null;
    if (payload?.csrfToken) this.csrf = payload.csrfToken;
    return { status: res.status, body: payload };
  }
}

const report = [];
const note = (step, status, extra = {}) => {
  report.push({ step, status, ...extra });
  console.log(`${step} ${status}${extra.detail ? ` ${extra.detail}` : ''}`);
};
const expect = (step, res, ok) => {
  const good = ok.includes(res.status);
  note(step, res.status, {
    detail: good ? res.body?.status ?? res.body?.currency ?? '' : res.body?.error?.message ?? '',
    ok: good,
  });
  if (!good) throw new Error(`${step} -> ${res.status} ${res.body?.error?.message ?? ''}`);
  return res.body;
};

async function loginStaff(email, secret) {
  const s = new Session();
  let code = secret ? totp(secret) : undefined;
  let res = await s.call('POST', '/v1/auth/login', { email, password, ...(code ? { mfaCode: code } : {}) });
  if (res.status === 401 && secret) {
    const delay = 30_000 - (Date.now() % 30_000) + 400;
    await new Promise((r) => setTimeout(r, delay));
    code = totp(secret);
    res = await s.call('POST', '/v1/auth/login', { email, password, mfaCode: code });
  }
  expect(`login ${email.split('@')[0]}`, res, [200]);
  return s;
}

const owner = await loginStaff(ownerEmail, ownerSecret);
const attorney = await loginStaff('preview.attorney@example.test');
const paralegal = await loginStaff('preview.paralegal@example.test');
const billing = await loginStaff('preview.billing@example.test', billingSecret);
const intern = await loginStaff('preview.intern@example.test');

const members = expect('members', await owner.call('GET', '/v1/organization/members'), [200]);
const idOf = (role) => members.data.find((m) => m.role === role)?.userId;
const attorneyId = idOf('attorney');
const paralegalId = idOf('paralegal');
const internId = idOf('intern');

const reg = await owner.call('POST', '/v1/auth/register', {
  organizationName: 'Nope',
  name: 'Nope',
  email: 'nope-journey@example.test',
  password: 'not-a-real-password',
});
note('registration stays off', reg.status, { ok: reg.status === 403 });

const client = expect(
  'intake client',
  await owner.call('POST', '/v1/clients', {
    type: 'organization',
    name: 'Synthetic Journey Pvt Ltd',
    email: 'journey@example.test',
  }),
  [201],
);
const conflict = expect(
  'conflict check',
  await paralegal.call('POST', '/v1/conflict-checks', { names: ['Synthetic Journey Pvt Ltd'] }),
  [200, 201],
);
note('conflict is human review', conflict.status ?? 'recorded', { detail: 'not an automatic clearance' });

const matter = expect(
  'create matter',
  await owner.call('POST', '/v1/matters', {
    clientId: client.id,
    title: 'Synthetic journey matter',
    practiceArea: 'litigation',
    description: 'Connected local journey. Not a client file.',
    court: {
      name: 'Synthetic court',
      caseNumber: 'JRN/1/2026',
      jurisdiction: 'Unknown',
      filedOn: '2026-11-02',
      cnr: 'SYNTHETICJOURNEY',
      officialUrl: 'https://example.com/synthetic-journey',
    },
    leadAttorneyId: attorneyId,
  }),
  [201],
);
expect(
  'team',
  await owner.call('POST', '/v1/teams', {
    name: `Journey team ${Date.now().toString(36)}`,
    userIds: [attorneyId, paralegalId, internId].filter(Boolean),
  }),
  [201],
);
expect(
  'party',
  await owner.call('POST', `/v1/matters/${matter.id}/parties`, {
    name: 'Synthetic Opponent',
    type: 'individual',
    role: 'opposing_party',
  }),
  [201],
);

const other = expect(
  'other matter',
  await owner.call('POST', '/v1/matters', {
    clientId: client.id,
    title: 'Matter the intern is not assigned',
    practiceArea: 'litigation',
    description: 'Negative access check.',
  }),
  [201],
);

const bytes = Buffer.from('synthetic journey note\n');
const created = expect(
  'upload request',
  await owner.call('POST', `/v1/matters/${matter.id}/documents`, {
    title: 'Journey private note',
    filename: 'journey-note.txt',
    contentType: 'text/plain',
    sizeBytes: bytes.length,
  }),
  [201],
);
const put = await fetch(created.upload.url, {
  method: created.upload.method ?? 'PUT',
  headers: created.upload.headers ?? { 'content-type': 'text/plain' },
  body: bytes,
});
note('upload bytes', put.status, { ok: put.status === 200 });
expect(
  'upload complete',
  await owner.call(
    'POST',
    `/v1/documents/${created.document.id}/versions/${created.version.version}/complete`,
  ),
  [200],
);
let scan = 'scanning';
for (let i = 0; i < 20; i++) {
  const doc = await owner.call('GET', `/v1/documents/${created.document.id}`);
  const versions = doc.body?.versions ?? [];
  scan = versions.at(-1)?.status ?? doc.body?.status;
  if (scan && scan !== 'scanning' && scan !== 'pending_upload') break;
  await new Promise((r) => setTimeout(r, 500));
}
note('scan result', 200, { detail: String(scan), ok: scan === 'skipped' || scan === 'clean' });
const link = await owner.call(
  'POST',
  `/v1/documents/${created.document.id}/versions/${created.version.version}/download-link`,
);
if (link.status === 200 || link.status === 201) {
  const file = await fetch(link.body.url);
  const got = Buffer.from(await file.arrayBuffer());
  note('staff download', file.status, { detail: got.equals(bytes) ? 'bytes match' : 'bytes differ', ok: got.equals(bytes) });
} else {
  note('staff download', link.status, { detail: link.body?.error?.message ?? '', ok: false });
}
if (scan === 'clean') {
  note('clean scan leaves sharing to the scanner check', 200, { ok: true });
} else {
  const share = await owner.call(
    'PUT',
    `/v1/documents/${created.document.id}/versions/${created.version.version}/share`,
    { shared: true },
  );
  note('portal share of unscanned file', share.status, {
    detail: share.body?.error?.message ?? '',
    ok: scan === 'skipped' && share.status === 409,
  });
}
const exe = await owner.call('POST', `/v1/matters/${matter.id}/documents`, {
  title: 'Blocked',
  filename: 'payload.exe',
  contentType: 'application/x-msdownload',
  sizeBytes: 12,
});
note('executable rejected', exe.status, { ok: exe.status === 400 });

const hearing = expect(
  'hearing',
  await paralegal.call('POST', '/v1/calendar/events', {
    kind: 'hearing',
    title: 'Journey hearing',
    description: 'Draft hearing. Not a court listing.',
    startsAt: '2026-12-02T04:30:00.000Z',
    matterId: matter.id,
  }),
  [201],
);
expect(
  'outcome draft',
  await paralegal.call('POST', `/v1/calendar/events/${hearing.id}/outcome`, {
    result: 'adjourned',
    notes: 'A person typed this note. It is not a court order.',
    nextHearingOn: '2026-12-20',
  }),
  [200, 201],
);
const paralegalReview = await paralegal.call('POST', `/v1/calendar/events/${hearing.id}/outcome/review`);
note('paralegal cannot review outcome', paralegalReview.status, { ok: paralegalReview.status === 403 });
expect('lawyer reviews outcome', await attorney.call('POST', `/v1/calendar/events/${hearing.id}/outcome/review`), [200, 201]);
expect('schedule next typed date', await attorney.call('POST', `/v1/calendar/events/${hearing.id}/schedule-next`), [200, 201]);

const deadline = expect(
  'typed date draft',
  await paralegal.call('POST', '/v1/deadlines', {
    matterId: matter.id,
    kind: 'other_deadline',
    title: 'Journey typed date',
    basisNote: 'A person chose this date. It is not a limitation calculation.',
    dueOn: '2026-12-18',
  }),
  [201],
);
expect('submit date', await paralegal.call('POST', `/v1/deadlines/${deadline.id}/submit`), [200, 201]);
const paralegalApprove = await paralegal.call('POST', `/v1/deadlines/${deadline.id}/approve`);
note('paralegal cannot approve date', paralegalApprove.status, { ok: paralegalApprove.status === 403 });
expect('lawyer approves date', await attorney.call('POST', `/v1/deadlines/${deadline.id}/approve`), [200, 201]);

const task = expect(
  'assign intern task',
  await attorney.call('POST', '/v1/tasks', {
    title: 'Journey filing bundle',
    description: 'Intern work. Not legal approval.',
    matterId: matter.id,
    assigneeId: internId,
    priority: 'normal',
  }),
  [201],
);
expect('intern sees assigned matter', await intern.call('GET', `/v1/matters/${matter.id}`), [200]);
expect('intern updates own task', await intern.call('PATCH', `/v1/tasks/${task.id}`, { status: 'in_progress' }), [200, 201]);
const internOther = await intern.call('GET', `/v1/matters/${other.id}`);
note('intern denied other matter', internOther.status, { ok: internOther.status === 404 });
const internApprove = await intern.call('POST', `/v1/deadlines/${deadline.id}/approve`);
note('intern cannot approve date', internApprove.status, { ok: internApprove.status === 403 || internApprove.status === 404 });

const localMail = expect(
  'email preview',
  await paralegal.call('POST', '/v1/outbox', {
    clientId: client.id,
    matterId: matter.id,
    channel: 'email',
    templateLabel: 'Journey local copy',
    body: 'This copy stays on this computer. It is not sent.',
    consent: { optedIn: true, namesFirm: true, note: 'Synthetic opt-in.' },
  }),
  [201],
);
const held = expect('lawyer approves local email', await attorney.call('POST', `/v1/outbox/${localMail.id}/approve`), [200, 201]);
note('local email not sent', held.status === 'held_local' ? 200 : 409, {
  detail: `${held.status} ${held.provider}`,
  ok: held.status === 'held_local',
});

const mock = expect(
  'mock update preview',
  await paralegal.call('POST', '/v1/outbox', {
    clientId: client.id,
    matterId: matter.id,
    channel: 'whatsapp',
    templateLabel: 'Journey mock update',
    body: 'Mock delivery only. No WhatsApp account was called.',
    consent: { optedIn: true, namesFirm: true, note: 'Synthetic opt-in.' },
  }),
  [201],
);
const delivered = expect('lawyer approves mock update', await attorney.call('POST', `/v1/outbox/${mock.id}/approve`), [200, 201]);
note('mock provider no socket', delivered.provider === 'mock' ? 200 : 409, {
  detail: `${delivered.status} ${delivered.provider}`,
  ok: delivered.status === 'mock_delivered' && delivered.provider === 'mock',
});

expect(
  'publish matter to portal',
  await owner.call('PUT', `/v1/matters/${matter.id}/portal`, {
    visible: true,
    note: 'Synthetic release. Not a filing.',
  }),
  [200],
);

const settings = await billing.call('GET', '/v1/billing/settings');
note('billing currency', settings.status, { detail: settings.body?.currency, ok: settings.body?.currency === 'INR' });
const entry = expect(
  'time entry',
  await attorney.call('POST', '/v1/time-entries', {
    matterId: matter.id,
    workDate: '2026-11-08',
    minutes: 60,
    description: 'Synthetic attendance note. Not a fee opinion.',
    billable: true,
  }),
  [201],
);
const draft = expect(
  'taxed draft invoice',
  await billing.call('POST', '/v1/invoices', {
    clientId: client.id,
    timeEntryIds: [entry.id],
    taxRateBp: 1800,
    notes: 'A person set 18 percent. The software did not choose GST.',
  }),
  [201],
);
const early = await billing.call('POST', `/v1/invoices/${draft.id}/issue`);
note('taxed issue blocked before accountant', early.status, { ok: early.status === 409 });
expect('accountant review', await billing.call('POST', `/v1/invoices/${draft.id}/accountant-review`), [200, 201]);
const issued = expect('issue invoice', await billing.call('POST', `/v1/invoices/${draft.id}/issue`), [200, 201]);
const unpaid = expect(
  'draft stays unissued',
  await billing.call('POST', '/v1/invoices', {
    clientId: client.id,
    taxRateBp: 0,
    notes: 'Draft that must stay off the portal.',
  }),
  [201],
);
await billing.call('POST', `/v1/invoices/${unpaid.id}/lines`, {
  type: 'expense',
  description: 'Unissued synthetic line.',
  amountCents: 10000,
});
const paid = expect(
  'manual payment',
  await billing.call(
    'POST',
    `/v1/invoices/${issued.id}/payments`,
    {
      amountCents: issued.totalCents,
      method: 'bank_transfer',
      reference: 'SYNTHETIC-NEFT',
    },
    { 'idempotency-key': `journey-${issued.id}` },
  ),
  [200, 201],
);
note('invoice currency and status', 200, { detail: `${paid.currency} ${paid.status}`, ok: paid.currency === 'INR' && paid.status === 'paid' });

const otherClient = expect(
  'second client',
  await owner.call('POST', '/v1/clients', {
    type: 'individual',
    name: 'Synthetic Other Client',
    email: 'other.client@example.test',
  }),
  [201],
);
const otherMatter = expect(
  'second client matter',
  await owner.call('POST', '/v1/matters', {
    clientId: otherClient.id,
    title: 'Other client matter',
    practiceArea: 'litigation',
    description: 'Must not appear for the first portal user.',
  }),
  [201],
);
expect(
  'publish other matter',
  await owner.call('PUT', `/v1/matters/${otherMatter.id}/portal`, { visible: true }),
  [200],
);
const invite = expect(
  'portal invite',
  await owner.call('POST', `/v1/clients/${client.id}/portal-invitations`, {
    email: 'journey.client@example.test',
    name: 'Journey Client',
  }),
  [201],
);
const portal = new Session();
expect(
  'portal accept',
  await portal.call('POST', '/v1/portal/auth/accept-invitation', {
    token: invite.token,
    name: 'Journey Client',
    password,
  }),
  [200, 201],
);
const portalLogin = new Session();
expect(
  'portal login',
  await portalLogin.call('POST', '/v1/portal/auth/login', {
    organizationSlug: slug,
    email: 'journey.client@example.test',
    password,
  }),
  [200],
);
const portalMatters = expect('portal matters', await portalLogin.call('GET', '/v1/portal/matters'), [200]);
const titles = (portalMatters.data ?? []).map((m) => m.title);
note('portal sees own matter', 200, {
  detail: titles.join(', '),
  ok: titles.includes('Synthetic journey matter') && !titles.includes('Other client matter'),
});
const hidden = await portalLogin.call('GET', `/v1/portal/matters/${otherMatter.id}`);
note('portal other matter hidden', hidden.status, { ok: hidden.status === 404 });
const portalInvoices = expect(
  'portal invoices',
  await portalLogin.call('GET', `/v1/portal/matters/${matter.id}/invoices`),
  [200],
);
const invoiceStatuses = (portalInvoices.data ?? []).map((i) => i.status);
note('portal invoices are issued or paid', 200, {
  detail: invoiceStatuses.join(',') || 'none',
  ok: invoiceStatuses.includes('paid') && invoiceStatuses.every((s) => s === 'issued' || s === 'paid'),
});
const portalMessages = expect(
  'portal messages',
  await portalLogin.call('GET', `/v1/portal/matters/${matter.id}/messages`),
  [200],
);
const messageBodies = (portalMessages.data ?? []).map((m) => m.body ?? '');
note('portal sees mock update only', 200, {
  detail: `${portalMessages.data?.length ?? 0} messages`,
  ok:
    messageBodies.some((b) => b.includes('Mock delivery only')) &&
    !messageBodies.some((b) => b.includes('stays on this computer')),
});
const portalDocs = expect(
  'portal documents',
  await portalLogin.call('GET', `/v1/portal/matters/${matter.id}/documents`),
  [200],
);
note('portal has no unscanned file', 200, {
  detail: `${portalDocs.data?.length ?? 0} documents`,
  ok: (portalDocs.data ?? []).length === 0,
});

const ids = {
  matterId: matter.id,
  otherMatterId: other.id,
  hearingId: hearing.id,
  deadlineId: deadline.id,
  taskId: task.id,
  invoiceId: issued.id,
  documentId: created.document.id,
  portalEmail: 'journey.client@example.test',
  matterTitle: 'Synthetic journey matter',
};
writeText(resolve(root, '.data/journey-ids.json'), JSON.stringify(ids, null, 2));
const failed = report.filter((r) => r.ok === false);
writeText(resolve(root, '.data/journey-report.json'), JSON.stringify({ failed: failed.length, report }, null, 2));
if (failed.length) {
  console.error(`Journey finished with ${failed.length} failed checks.`);
  process.exit(1);
}
console.log('Journey checks passed.');
