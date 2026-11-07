import { createCanvas } from '@napi-rs/canvas';
import type { INestApplication } from '@nestjs/common';
import { AuditLogModel } from '@assar/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EICAR,
  addMember,
  bootApp,
  envOf,
  newClient,
  newMatter,
  post,
  registerWithMfa,
  settle,
  startFakeClamd,
  startTestWorkers,
  tempStorageDir,
  uploadDocument,
  type Owner,
  type TestWorkers,
} from './helpers';

let app: INestApplication;
let clamd: Awaited<ReturnType<typeof startFakeClamd>>;
let workers: TestWorkers;
const storage = tempStorageDir();

beforeAll(async () => {
  clamd = await startFakeClamd();
  app = await bootApp({
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: storage.dir,
    PUBLIC_API_URL: 'http://api.test',
    SCAN_PROVIDER: 'clamav',
    CLAMAV_HOST: '127.0.0.1',
    CLAMAV_PORT: String(clamd.port),
    MAX_UPLOAD_BYTES: '5000000',
  });
  workers = startTestWorkers(envOf(app), { clamdPort: clamd.port });
});
afterAll(async () => {
  await workers.close();
  await app.close();
  await clamd.close();
  storage.cleanup();
});

/** A clean "scan": black text on white, as a PNG. */
function scanPng(lines: string[], blank = false): Buffer {
  const canvas = createCanvas(1400, 140 + lines.length * 90);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 48px sans-serif';
  if (!blank) lines.forEach((l, i) => ctx.fillText(l, 60, 100 + i * 90));
  return canvas.toBuffer('image/png');
}

const LEASE_1 =
  'Commercial lease agreement. The tenant shall pay monthly rent for the premises. The landlord shall repair the heating and ventilation equipment. Termination requires written notice.';
const LEASE_2 =
  'Lease for commercial premises. Monthly rent is payable by the tenant; the landlord repairs ventilation and heating. Written notice is required for termination of the lease.';
const NDA =
  'Mutual confidentiality agreement. Each recipient must protect proprietary information and return confidential materials on request.';

async function upload(
  who: Owner,
  matterId: string,
  title: string,
  content: string | Buffer,
  over: object = {},
) {
  const r = await uploadDocument(app, who, matterId, {
    title,
    filename: `${title}.txt`,
    content,
    ...over,
  });
  await settle(app); // scan, then text extraction
  return r;
}
const textOf = (who: Owner, docId: string, qs = '') =>
  who.agent.get(`/v1/documents/${docId}/versions/1/text${qs}`);

async function waitForText(
  who: Owner,
  docId: string,
  want: string[] = ['done', 'failed'],
  ms = 60_000,
) {
  const deadline = Date.now() + ms;
  for (;;) {
    const res = await textOf(who, docId);
    if (want.includes(res.body.status)) return res.body;
    if (Date.now() > deadline) throw new Error(`timed out; last: ${JSON.stringify(res.body)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('text extraction after upload', () => {
  it('reads a text file automatically once it is scanned clean, and shows its status on the version', async () => {
    const o = await registerWithMfa(app);
    const m = await newMatter(o, await newClient(o));
    const { docId } = await upload(o, m.id, 'Lease', LEASE_1);
    const t = await waitForText(o, docId);
    expect(t).toMatchObject({
      status: 'done',
      method: 'text',
      ocrPages: 0,
      confidence: null,
      truncated: false,
    });
    expect(t.text).toContain('monthly rent');
    expect(t.chars).toBe(LEASE_1.length);

    const detail = (await o.agent.get(`/v1/documents/${docId}`).expect(200)).body;
    expect(detail.versions[0].text).toMatchObject({ status: 'done', method: 'text' });
    expect(JSON.stringify(detail)).not.toContain('monthly rent'); // the text has its own endpoint
  });

  it('reads a scanned image with OCR and reports how confident it is', async () => {
    const o = await registerWithMfa(app);
    const m = await newMatter(o, await newClient(o));
    const { docId } = await upload(
      o,
      m.id,
      'Scanned notice',
      scanPng(['LEGAL NOTICE OF TERMINATION', 'Tenant shall vacate within thirty days']),
      {
        filename: 'notice.png',
        contentType: 'image/png',
      },
    );
    const t = await waitForText(o, docId);
    expect(t).toMatchObject({ status: 'done', method: 'ocr', pages: 1, ocrPages: 1 });
    expect(t.confidence).toBeGreaterThan(70);
    expect(t.text.toLowerCase()).toContain('legal notice');
    expect(t.text.toLowerCase()).toContain('thirty days');
  }, 90_000);

  it('records a clear failure for an unreadable scan, then lets someone retry', async () => {
    const o = await registerWithMfa(app);
    const m = await newMatter(o, await newClient(o));
    const { docId } = await upload(o, m.id, 'Blank page', scanPng([], true), {
      filename: 'blank.png',
      contentType: 'image/png',
    });
    const t = await waitForText(o, docId);
    expect(t).toMatchObject({ status: 'failed', error: { code: 'NO_TEXT_EXTRACTED' } });
    expect(t.text).toBeUndefined();

    const again = await post(o, `/v1/documents/${docId}/versions/1/extract`, {});
    expect(again.status).toBe(202);
    expect((await waitForText(o, docId)).status).toBe('failed'); // still blank, but it ran again
  }, 90_000);

  it('never opens an infected file', async () => {
    const o = await registerWithMfa(app);
    const m = await newMatter(o, await newClient(o));
    const { docId } = await upload(o, m.id, 'Bad', EICAR);
    expect((await textOf(o, docId)).body.status).toBe('none');
    expect((await post(o, `/v1/documents/${docId}/versions/1/extract`, {})).status).toBe(409);
  });

  it('keeps document text out of the audit log', async () => {
    const o = await registerWithMfa(app);
    const m = await newMatter(o, await newClient(o));
    const { docId } = await upload(
      o,
      m.id,
      'Secret terms',
      'The confidential price is exactly 4,321,987 rupees.',
    );
    await waitForText(o, docId);
    await textOf(o, docId, '?full=true');
    const rows = await AuditLogModel.find({
      organizationId: o.body.organization.id,
      action: /^document\.text/,
    }).lean();
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['document.text_extracted', 'document.text_viewed']),
    );
    expect(JSON.stringify(rows)).not.toMatch(/4,321,987|confidential price/);
  });

  it('enforces permissions and matter access on the text', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const billing = await addMember(app, owner, 'billing');
    const clientId = await newClient(owner);
    const secret = await newMatter(owner, clientId, { restricted: true });
    const { docId } = await upload(owner, secret.id, 'Hidden', LEASE_1);
    await waitForText(owner, docId);
    expect((await textOf(attorney as unknown as Owner, docId)).status).toBe(404); // restricted matter
    expect((await textOf(billing as unknown as Owner, docId)).status).toBe(403); // no document:read
    expect((await post(attorney, `/v1/documents/${docId}/versions/1/extract`, {})).status).toBe(
      404,
    );
    const other = await registerWithMfa(app, 'Other');
    expect((await textOf(other, docId)).status).toBe(404);
  });

  it('limits the preview but returns everything on request', async () => {
    const o = await registerWithMfa(app);
    const m = await newMatter(o, await newClient(o));
    const long = 'Clause about payment terms and obligations. '.repeat(1000); // ~44k chars
    const { docId } = await upload(o, m.id, 'Long', long);
    await waitForText(o, docId);
    const preview = (await textOf(o, docId)).body;
    expect(preview.text.length).toBe(20_000);
    expect(preview.textTruncated).toBe(true);
    const full = (await textOf(o, docId, '?full=true')).body;
    expect(full.text.length).toBeGreaterThan(40_000);
    expect(full.textTruncated).toBe(false);
  });
});

describe('searching inside documents', () => {
  it('finds documents by what they say (including scans) and shows where', async () => {
    const o = await registerWithMfa(app);
    const m = await newMatter(o, await newClient(o));
    await upload(o, m.id, 'Lease', LEASE_1);
    await upload(o, m.id, 'NDA', NDA);
    const scan = await upload(
      o,
      m.id,
      'Scanned letter',
      scanPng(['DEMAND FOR PAYMENT', 'Invoice overdue by ninety days']),
      { filename: 'letter.png', contentType: 'image/png' },
    );
    await waitForText(o, scan.docId);

    const lease = (await o.agent.get('/v1/search/documents?q=ventilation').expect(200)).body.data;
    expect(lease.map((d: { title: string }) => d.title)).toEqual(['Lease']);
    expect(lease[0].snippet.toLowerCase()).toContain('ventilation');
    expect(lease[0].matter.matterNumber).toMatch(/^M-/);

    const ocr = (await o.agent.get('/v1/search/documents?q=overdue').expect(200)).body.data;
    expect(ocr.map((d: { title: string }) => d.title)).toEqual(['Scanned letter']);
    expect(ocr[0].method).toBe('ocr');

    expect(
      (await o.agent.get('/v1/search/documents?q=zzzznotthere').expect(200)).body.data,
    ).toEqual([]);
    expect((await o.agent.get('/v1/search/documents?q=a').expect(400)).status).toBe(400);
  }, 90_000);

  it('never returns documents from restricted matters or other firms, or deleted documents', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const open = await newMatter(owner, clientId);
    const secret = await newMatter(owner, clientId, { restricted: true });
    await upload(owner, open.id, 'Open doc', 'The warehouse inventory shipment arrived in Mumbai.');
    const hidden = await upload(
      owner,
      secret.id,
      'Secret doc',
      'The warehouse inventory acquisition price is confidential.',
    );
    const gone = await upload(
      owner,
      open.id,
      'Deleted doc',
      'The warehouse inventory list was removed.',
    );
    await owner.agent
      .delete(`/v1/documents/${gone.docId}`)
      .set('x-csrf-token', owner.csrf)
      .expect(204);
    await waitForText(owner, hidden.docId);

    const titles = async (who: { agent: Owner['agent'] }) =>
      (
        (await who.agent.get('/v1/search/documents?q=warehouse').expect(200)).body.data as {
          title: string;
        }[]
      )
        .map((d) => d.title)
        .sort();
    expect(await titles(attorney)).toEqual(['Open doc']);
    expect(await titles(owner)).toEqual(['Open doc', 'Secret doc']);
    await attorney.agent.get(`/v1/search/documents?q=warehouse&matterId=${secret.id}`).expect(404);

    const other = await registerWithMfa(app, 'Other');
    expect(await titles(other)).toEqual([]);
  });

  it('treats the query as words, not as a search expression', async () => {
    const o = await registerWithMfa(app);
    const m = await newMatter(o, await newClient(o));
    await upload(o, m.id, 'Plain', 'Payment of rent is due monthly.');
    for (const q of ['.*', '"rent', '-rent', 'rent OR (', '$where']) {
      const res = await o.agent.get(`/v1/search/documents?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
    }
  });
});

describe('similar documents', () => {
  it('ranks documents with similar content above unrelated ones, and explains why', async () => {
    const o = await registerWithMfa(app);
    const clientId = await newClient(o);
    const a = await newMatter(o, clientId, { title: 'Lease A' });
    const b = await newMatter(o, clientId, { title: 'Lease B' });
    const first = await upload(o, a.id, 'Lease 2024', LEASE_1);
    await upload(o, b.id, 'Lease 2026', LEASE_2);
    await upload(o, b.id, 'Mutual NDA', NDA);
    await waitForText(o, first.docId);

    const res = (await o.agent.get(`/v1/documents/${first.docId}/similar`).expect(200)).body.data;
    expect(res[0]).toMatchObject({ title: 'Lease 2026' });
    expect(res[0].similarity).toBeGreaterThan(0.25);
    expect(res[0].sharedTerms.length).toBeGreaterThan(2);
    expect(res[0].matter.title).toBe('Lease B');
    const nda = res.find((d: { title: string }) => d.title === 'Mutual NDA');
    if (nda) expect(nda.similarity).toBeLessThan(res[0].similarity);
    expect(res.map((d: { documentId: string }) => d.documentId)).not.toContain(first.docId); // never itself
  });

  it('does not reveal restricted or other-firm documents, and needs text to be read first', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await addMember(app, owner, 'attorney');
    const clientId = await newClient(owner);
    const open = await newMatter(owner, clientId);
    const secret = await newMatter(owner, clientId, { restricted: true });
    const mine = await upload(owner, open.id, 'Mine', LEASE_1);
    await upload(owner, secret.id, 'Secret lease', LEASE_2);
    await waitForText(owner, mine.docId);

    const asOwner = (await owner.agent.get(`/v1/documents/${mine.docId}/similar`).expect(200)).body
      .data;
    expect(asOwner.map((d: { title: string }) => d.title)).toContain('Secret lease');
    const asAttorney = (await attorney.agent.get(`/v1/documents/${mine.docId}/similar`).expect(200))
      .body.data;
    expect(JSON.stringify(asAttorney)).not.toContain('Secret lease');

    const other = await registerWithMfa(app, 'Other');
    await other.agent.get(`/v1/documents/${mine.docId}/similar`).expect(404);

    const blank = await upload(owner, open.id, 'Blank', scanPng([], true), {
      filename: 'b.png',
      contentType: 'image/png',
    });
    await waitForText(owner, blank.docId, ['failed']);
    expect((await owner.agent.get(`/v1/documents/${blank.docId}/similar`)).status).toBe(409);
  }, 90_000);
});
