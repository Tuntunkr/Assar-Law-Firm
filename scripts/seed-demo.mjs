/**
 * Seeds the local demo database through the API. Writes login material to
 * .data/demo-login.txt and nowhere else. Does not print the password.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = process.env.ASSAR_API_URL ?? 'http://127.0.0.1:4000';
const root = resolve(import.meta.dirname, '..');
const loginFile = resolve(root, '.data/demo-login.txt');

const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const decodeBase32 = (input) => {
  const s = input.replace(/=+$/u, '').toUpperCase();
  let bits = '';
  for (const c of s) {
    const v = ALPH.indexOf(c);
    if (v < 0) throw new Error('The authenticator secret was not base32.');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};
const totp = (secret, at = Date.now()) => {
  const step = Math.floor(at / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', decodeBase32(secret)).update(buf).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
};
/** The same 30-second code cannot be used twice. Wait for the next step. */
const nextTotp = async (secret) => {
  const used = Math.floor(Date.now() / 30_000);
  const delay = 30_000 - (Date.now() % 30_000) + 400;
  await new Promise((resolve) => setTimeout(resolve, delay));
  if (Math.floor(Date.now() / 30_000) <= used) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return totp(secret);
};

const password = `Syn${randomBytes(18).toString('base64url')}`;
const jar = new Map();
const store = (res) => {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const pair = line.split(';', 1)[0];
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
};
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

let csrf = '';
async function call(method, path, body, extra = {}) {
  const headers = { cookie: cookie(), ...extra };
  if (csrf) headers['x-csrf-token'] = csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  store(res);
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  const setStaffCsrf = (res.headers.getSetCookie?.() ?? []).some((line) =>
    line.startsWith('assar_csrf='),
  );
  if (payload?.csrfToken && setStaffCsrf) csrf = payload.csrfToken;
  return { status: res.status, body: payload };
}
const must = async (method, path, body, extra) => {
  const res = await call(method, path, body, extra);
  if (res.status >= 400) {
    const message = res.body?.error?.message ?? JSON.stringify(res.body);
    throw new Error(`${method} ${path} -> ${res.status} ${message}`);
  }
  return res.body;
};

const ownerEmail = 'preview.owner@example.test';
const staff = [
  ['attorney', 'preview.attorney@example.test'],
  ['paralegal', 'preview.paralegal@example.test'],
  ['billing', 'preview.billing@example.test'],
  ['staff', 'preview.staff@example.test'],
  ['intern', 'preview.intern@example.test'],
];

async function enroll(label) {
  const setup = await must('POST', '/v1/auth/mfa/setup');
  const enabled = await must('POST', '/v1/auth/mfa/enable', { code: totp(setup.secret) });
  return { label, secret: setup.secret, recovery: enabled.recoveryCodes?.[0] ?? '' };
}

const existing = await call('POST', '/v1/auth/register', {
  organizationName: 'Synthetic Preview LLP',
  name: 'Preview Owner',
  email: ownerEmail,
  password,
});
if (existing.status === 409) {
  console.error(
    'Demo firm already exists and this run did not create .data/demo-login.txt. Run: bash scripts/local-demo.sh reset',
  );
  process.exit(1);
}
if (existing.status !== 201) {
  throw new Error(`Register failed: ${existing.status} ${existing.body?.error?.message ?? ''}`);
}

const ownerMfa = await enroll('owner');
const slug = existing.body.organization.slug;
const lines = [
  'Synthetic local demo. These are not production credentials.',
  'Do not use a real client, a real court, or a real phone number.',
  `Organization: Synthetic Preview LLP`,
  `Slug: ${slug}`,
  `Staff sign-in: http://127.0.0.1:3001/login`,
  `Portal: http://127.0.0.1:3002`,
  `Marketing: http://127.0.0.1:3000`,
  `API: http://127.0.0.1:4000`,
  `Owner email: ${ownerEmail}`,
  `Shared synthetic password: ${password}`,
  `Owner authenticator secret: ${ownerMfa.secret}`,
  `Owner recovery code: ${ownerMfa.recovery}`,
];

for (const [role, email] of staff) {
  const key = randomBytes(8).toString('hex');
  const invite = await must(
    'POST',
    '/v1/organization/invitations',
    { email, role },
    { 'idempotency-key': key },
  );
  const savedJar = new Map(jar);
  const savedCsrf = csrf;
  await must('POST', '/v1/auth/accept-invitation', {
    token: invite.token,
    name: `Preview ${role}`,
    password,
  });
  jar.clear();
  for (const [name, value] of savedJar) jar.set(name, value);
  csrf = savedCsrf;
  lines.push(`${role} email: ${email}`);
}

const billingLogin = await call('POST', '/v1/auth/login', {
  email: 'preview.billing@example.test',
  password,
});
if (billingLogin.status !== 200) {
  throw new Error(`Billing sign-in failed: ${billingLogin.status} ${billingLogin.body?.error?.message ?? ''}`);
}
if (billingLogin.body?.mfa?.enrollmentRequired) {
  const billingMfa = await enroll('billing');
  lines.push(`Billing authenticator secret: ${billingMfa.secret}`);
  lines.push(`Billing recovery code: ${billingMfa.recovery}`);
}
await call('POST', '/v1/auth/logout');
await must('POST', '/v1/auth/login', {
  email: ownerEmail,
  password,
  mfaCode: await nextTotp(ownerMfa.secret),
});

const client = await must('POST', '/v1/clients', {
  type: 'organization',
  name: 'Synthetic Preview Pvt Ltd',
  email: 'desk@example.test',
});
const matter = await must('POST', '/v1/matters', {
  clientId: client.id,
  title: 'Synthetic preview matter',
  practiceArea: 'litigation',
  description: 'Synthetic fixture. Not a client file and not a court record.',
  court: {
    name: 'Synthetic court',
    caseNumber: 'SYN/1/2026',
    jurisdiction: 'Unknown',
    filedOn: '2026-11-01',
    cnr: 'SYNTHETICPREVIEW',
    officialUrl: 'https://example.com/synthetic-cause-list',
  },
});
await must('POST', '/v1/deadlines', {
  matterId: matter.id,
  kind: 'other_deadline',
  title: 'Synthetic typed date',
  basisNote: 'A person typed this date. It is not a limitation calculation.',
  dueOn: '2026-12-15',
});
await must('POST', '/v1/calendar/events', {
  kind: 'hearing',
  title: 'Synthetic hearing',
  description: 'A draft hearing. A lawyer has not reviewed an outcome.',
  startsAt: '2026-12-01T04:30:00.000Z',
  matterId: matter.id,
});
await must('POST', '/v1/outbox', {
  clientId: client.id,
  matterId: matter.id,
  channel: 'email',
  templateLabel: 'Synthetic update',
  body: 'This preview stays on this computer until a lawyer approves it. Approval with local delivery still does not send email.',
  consent: { optedIn: true, namesFirm: true, note: 'Synthetic opt-in for the local demo.' },
});
const invoice = await must('POST', '/v1/invoices', { clientId: client.id, taxRateBp: 0 });
await must('POST', `/v1/invoices/${invoice.id}/lines`, {
  type: 'expense',
  description: 'Synthetic retainer. Not a tax invoice.',
  amountCents: 500000,
});
await must('PUT', `/v1/matters/${matter.id}/portal`, { visible: true });
const portal = await must('POST', `/v1/clients/${client.id}/portal-invitations`, {
  email: 'preview.client@example.test',
  name: 'Preview Client',
});
await must('POST', '/v1/portal/auth/accept-invitation', {
  token: portal.token,
  name: 'Preview Client',
  password,
});
lines.push('Portal email: preview.client@example.test');
lines.push('Portal uses the shared synthetic password. Portal accounts do not use the staff authenticator.');
lines.push('Matter title: Synthetic preview matter');

mkdirSync(resolve(root, '.data'), { recursive: true });
writeFileSync(loginFile, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log('Seeded the synthetic firm. Login material is in .data/demo-login.txt.');
