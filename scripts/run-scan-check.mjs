/**
 * Checks the live worker against the local clamd. Prints statuses only.
 * A clean result has to come from clamd. This script never writes a scan status itself.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = process.env.ASSAR_API_URL ?? 'http://127.0.0.1:4000';
const root = resolve(import.meta.dirname, '..');
const login = readFileSync(resolve(root, '.data/demo-login.txt'), 'utf8');
const ids = JSON.parse(readFileSync(resolve(root, '.data/journey-ids.json'), 'utf8'));
const grab = (label) => {
  const line = login.split('\n').find((l) => l.startsWith(label));
  if (!line) throw new Error(`missing ${label}`);
  return line.slice(label.length).trim();
};

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const cleanBytes = Buffer.from('synthetic scanned note for the portal\n');

class Session {
  constructor() {
    this.jar = new Map();
    this.csrf = '';
  }
  async call(method, path, body) {
    const headers = { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
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

const note = (step, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'} ${step}${detail ? ` ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};

async function upload(session, matterId, title, filename, bytes) {
  const created = await session.call('POST', `/v1/matters/${matterId}/documents`, {
    title,
    filename,
    contentType: 'text/plain',
    sizeBytes: bytes.length,
  });
  if (created.status !== 201) throw new Error(`upload request ${created.status} ${created.body?.error?.message ?? ''}`);
  const put = await fetch(created.body.upload.url, {
    method: created.body.upload.method ?? 'PUT',
    headers: created.body.upload.headers ?? { 'content-type': 'text/plain' },
    body: bytes,
  });
  if (put.status !== 200) throw new Error(`upload bytes ${put.status}`);
  const done = await session.call(
    'POST',
    `/v1/documents/${created.body.document.id}/versions/${created.body.version.version}/complete`,
  );
  if (done.status !== 200) throw new Error(`complete ${done.status}`);
  return { id: created.body.document.id, version: created.body.version.version };
}

async function waitStatus(session, id) {
  let status = 'scanning';
  let engine = '';
  for (let i = 0; i < 40; i++) {
    const doc = await session.call('GET', `/v1/documents/${id}`);
    const version = doc.body?.versions?.at(-1);
    status = version?.status ?? 'missing';
    engine = version?.scanResult ?? '';
    if (status !== 'scanning' && status !== 'pending_upload') return { status, engine };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { status, engine };
}

const attorney = new Session();
const loginRes = await attorney.call('POST', '/v1/auth/login', {
  email: grab('attorney email:'),
  password: grab('Shared synthetic password:'),
});
note('attorney login', loginRes.status === 200, String(loginRes.status));
if (loginRes.status !== 200) process.exit(1);

const oldShare = await attorney.call(
  'PUT',
  `/v1/documents/${ids.documentId}/versions/1/share`,
  { shared: true },
);
note('unscanned file stays unshared', oldShare.status === 409, oldShare.body?.error?.message ?? String(oldShare.status));

const clean = await upload(attorney, ids.matterId, 'Scanned portal note', 'scanned-note.txt', cleanBytes);
const cleanScan = await waitStatus(attorney, clean.id);
note('clamd marks the harmless file clean', cleanScan.status === 'clean' && cleanScan.engine === 'clean', `${cleanScan.status} ${cleanScan.engine}`);
if (cleanScan.status !== 'clean') process.exit(1);

const shared = await attorney.call('PUT', `/v1/documents/${clean.id}/versions/${clean.version}/share`, {
  shared: true,
});
note('attorney shares the clean file', shared.status === 200 && shared.body?.shared === true, String(shared.status));

const eicar = await upload(attorney, ids.matterId, 'EICAR test', 'eicar.txt', Buffer.from(EICAR));
const bad = await waitStatus(attorney, eicar.id);
note('clamd marks the EICAR test infected', bad.status === 'infected' && String(bad.engine).includes('Eicar'), `${bad.status} ${bad.engine}`);
const badShare = await attorney.call('PUT', `/v1/documents/${eicar.id}/versions/${eicar.version}/share`, {
  shared: true,
});
note('infected file cannot be shared', badShare.status === 409, badShare.body?.error?.message ?? String(badShare.status));

const portal = new Session();
const portalLogin = await portal.call('POST', '/v1/portal/auth/login', {
  organizationSlug: grab('Slug:'),
  email: ids.portalEmail,
  password: grab('Shared synthetic password:'),
});
note('portal login', portalLogin.status === 200, String(portalLogin.status));
const docs = await portal.call('GET', `/v1/portal/matters/${ids.matterId}/documents`);
const titles = (docs.body?.data ?? []).map((d) => d.title);
note('portal lists the clean file only', titles.includes('Scanned portal note') && !titles.includes('EICAR test') && !titles.includes('Journey private note'), titles.join(', ') || 'none');
const link = await portal.call('POST', `/v1/portal/documents/${clean.id}/versions/${clean.version}/download-link`);
note('portal download link', link.status === 200 || link.status === 201, String(link.status));
if (link.status === 200 || link.status === 201) {
  const file = await fetch(link.body.url);
  const got = Buffer.from(await file.arrayBuffer());
  note('portal bytes match', file.status === 200 && got.equals(cleanBytes), `${file.status} ${got.length}`);
}
if (process.exitCode) process.exit(process.exitCode);
console.log('Scan check passed.');
