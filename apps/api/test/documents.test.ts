import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EICAR,
  addMember,
  bootApp,
  del,
  envOf,
  newClient,
  newMatter,
  patch,
  post,
  put,
  registerWithMfa,
  settle,
  startFakeClamd,
  startTestWorkers,
  storedFiles,
  tempStorageDir,
  uploadDocument,
  putBytes,
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
    MAX_UPLOAD_BYTES: '5000',
  });
  workers = startTestWorkers(envOf(app), { clamdPort: clamd.port });
});
afterAll(async () => {
  await workers.close();
  await app.close();
  await clamd.close();
  storage.cleanup();
});
afterEach(() => {
  vi.useRealTimers();
  clamd.setMode('ok');
});

const download = async (who: Parameters<typeof post>[0], docId: string, version = 1) => {
  const link = await post(who, `/v1/documents/${docId}/versions/${version}/download-link`, {});
  return link;
};
const fetchLink = (url: string) => {
  const u = new URL(url);
  return request(app.getHttpServer())
    .get(u.pathname + u.search)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
};

async function setup() {
  const owner = await registerWithMfa(app);
  const attorney = await addMember(app, owner, 'attorney');
  const clientId = await newClient(owner);
  const matter = await newMatter(owner, clientId);
  return { owner, attorney, clientId, matter };
}

describe('upload → scan → download', () => {
  it('stores bytes in private storage and serves them only through a signed, short-lived link', async () => {
    const { attorney, matter } = await setup();
    const { docId, content, created } = await uploadDocument(app, attorney, matter.id, {
      filename: 'contract.txt',
    });

    expect(created.version.status).toBe('pending_upload');
    expect(created.upload.method).toBe('PUT');
    const detail = (await attorney.agent.get(`/v1/documents/${docId}`).expect(200)).body;
    expect(detail.versions[0]).toMatchObject({
      version: 1,
      status: 'clean',
      scanResult: 'clean',
      filename: 'contract.txt',
    });

    const link = (
      await download(attorney, docId).then((r) =>
        r.status === 200 ? r : Promise.reject(new Error(JSON.stringify(r.body))),
      )
    ).body;
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    const file = await fetchLink(link.url).expect(200);
    expect(file.body).toEqual(content);
    expect(file.headers['content-disposition']).toMatch(/attachment; filename="contract.txt"/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toContain('no-store');

    // Internals never leak: no storage keys in any response.
    expect(JSON.stringify([created, detail, link])).not.toMatch(/org\/[a-f0-9]{24}\/matter/);
  });

  it('keeps every version, numbers them atomically, and downloads each one', async () => {
    const { attorney, matter } = await setup();
    const { docId } = await uploadDocument(app, attorney, matter.id, { content: 'first draft' });

    const adds = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        post(attorney, `/v1/documents/${docId}/versions`, {
          filename: `v${i}.txt`,
          contentType: 'text/plain',
          sizeBytes: 10,
        }),
      ),
    );
    expect(adds.every((r) => r.status === 201)).toBe(true);
    expect(adds.map((r) => r.body.version.version).sort()).toEqual([2, 3, 4, 5]);

    const doc = (await attorney.agent.get(`/v1/documents/${docId}`).expect(200)).body;
    expect(doc.latestVersion).toBe(5);
    expect(doc.versions.map((v: { version: number }) => v.version)).toEqual([5, 4, 3, 2, 1]);
    expect((await download(attorney, docId, 1)).status).toBe(200); // old version still downloadable
    expect((await download(attorney, docId, 3)).status).toBe(409); // not uploaded yet

    const list = (await attorney.agent.get(`/v1/matters/${matter.id}/documents`).expect(200)).body;
    expect(list.data[0].latest.version).toBe(5);
  });

  it('refuses downloads until a clean scan, and quarantines infected files', async () => {
    const { attorney, matter } = await setup();
    const before = storedFiles(storage.dir).length;
    const { docId } = await uploadDocument(app, attorney, matter.id, {
      filename: 'eicar.txt',
      content: EICAR,
    });

    const v = (await attorney.agent.get(`/v1/documents/${docId}`).expect(200)).body.versions[0];
    expect(v.status).toBe('infected');
    expect(v.scanResult).toBe('Eicar-Test-Signature');
    const blocked = await download(attorney, docId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/failed the security scan/);
    expect(storedFiles(storage.dir).length).toBe(before); // infected object was deleted from storage

    // A document with no uploaded bytes isn't downloadable either.
    const created = await post(attorney, `/v1/matters/${matter.id}/documents`, {
      title: 'Empty',
      filename: 'a.txt',
      contentType: 'text/plain',
      sizeBytes: 5,
    });
    const pending = await download(attorney, created.body.document.id);
    expect(pending.status).toBe(409);
    expect(pending.body.error.message).toMatch(/not been uploaded/);
  });

  it('records scanner outages as scan_failed and recovers via re-scan', async () => {
    const { attorney, matter } = await setup();
    clamd.setMode('down');
    const { docId } = await uploadDocument(app, attorney, matter.id, {
      content: 'will be scanned later',
    });
    let v = (await attorney.agent.get(`/v1/documents/${docId}`).expect(200)).body.versions[0];
    expect(v.status).toBe('scan_failed');
    expect((await download(attorney, docId)).status).toBe(409);

    clamd.setMode('ok');
    expect((await post(attorney, `/v1/documents/${docId}/versions/1/rescan`, {})).status).toBe(200);
    await settle(app);
    v = (await attorney.agent.get(`/v1/documents/${docId}`).expect(200)).body.versions[0];
    expect(v.status).toBe('clean');
    expect((await download(attorney, docId)).status).toBe(200);
    expect((await post(attorney, `/v1/documents/${docId}/versions/1/rescan`, {})).status).toBe(409); // only failed scans
  });

  it('lets a scan that never finished be retried, but not a healthy in-progress one', async () => {
    const { attorney, matter } = await setup();
    const { docId } = await uploadDocument(app, attorney, matter.id);
    // Simulate a lost scan: force the version back to `scanning`.
    const { DocumentVersionModel } = await import('@assar/database');
    await DocumentVersionModel.updateOne(
      { documentId: docId },
      { status: 'scanning', completedAt: new Date() },
    );
    expect((await post(attorney, `/v1/documents/${docId}/versions/1/rescan`, {})).status).toBe(409); // recent: probably still running

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect((await post(attorney, `/v1/documents/${docId}/versions/1/rescan`, {})).status).toBe(200);
    vi.useRealTimers();
    await settle(app);
    expect(
      (await attorney.agent.get(`/v1/documents/${docId}`).expect(200)).body.versions[0].status,
    ).toBe('clean');
  });

  it('makes completion idempotent', async () => {
    const { attorney, matter } = await setup();
    const { docId } = await uploadDocument(app, attorney, matter.id);
    const again = await post(attorney, `/v1/documents/${docId}/versions/1/complete`, {});
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('clean');
  });
});

describe('upload validation & signed-URL security', () => {
  it('validates type, size and filename before issuing an upload URL', async () => {
    const { attorney, matter } = await setup();
    const base = { title: 'Doc', filename: 'a.txt', contentType: 'text/plain', sizeBytes: 10 };
    const url = `/v1/matters/${matter.id}/documents`;
    expect(
      (await post(attorney, url, { ...base, contentType: 'application/x-msdownload' })).status,
    ).toBe(400);
    expect((await post(attorney, url, { ...base, sizeBytes: 0 })).status).toBe(400);
    const tooBig = await post(attorney, url, { ...base, sizeBytes: 5001 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.message).toMatch(/maximum upload size/);
    const sneaky = await post(attorney, url, { ...base, filename: '../../etc/passwd' });
    expect(sneaky.status).toBe(201);
    expect(sneaky.body.version.filename).not.toMatch(/\//);
  });

  it('rejects tampered, mismatched and expired upload links', async () => {
    const { attorney, matter } = await setup();
    const bytes = Buffer.from('0123456789');
    const create = async () =>
      (
        await post(attorney, `/v1/matters/${matter.id}/documents`, {
          title: 'Sig',
          filename: 'a.txt',
          contentType: 'text/plain',
          sizeBytes: bytes.length,
        })
      ).body.upload;

    const up = await create();
    const tampered = up.url.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64));
    expect((await putBytes(app, { ...up, url: tampered }, bytes)).status).toBe(403);
    const resized = up.url.replace(/x=\d+/, 'x=999');
    expect((await putBytes(app, { ...up, url: resized }, bytes)).status).toBe(403); // size is part of the signature

    // Wrong content type / wrong length for a validly signed URL.
    const u = new URL(up.url);
    expect(
      (
        await request(app.getHttpServer())
          .put(u.pathname + u.search)
          .set('content-type', 'text/html')
          .send(bytes)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .put(u.pathname + u.search)
          .set('content-type', 'application/octet-stream')
          .send(Buffer.from('short'))
      ).status,
    ).toBe(400);

    // Expiry: the same link stops working once its TTL has passed.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect((await putBytes(app, up, bytes)).status).toBe(403);
    vi.useRealTimers();
    expect((await putBytes(app, up, bytes)).status).toBe(200); // still valid in real time
  });

  it('rejects tampered or expired download links', async () => {
    const { attorney, matter } = await setup();
    const { docId } = await uploadDocument(app, attorney, matter.id, { filename: 'safe.txt' });
    const link = (await download(attorney, docId)).body;

    expect((await fetchLink(link.url.replace(/x=[^&]+/, 'x=evil.exe'))).status).toBe(403); // filename is signed
    expect(
      (await fetchLink(link.url.replace(/key=[^&]+/, 'key=org%2Fother%2Fobject'))).status,
    ).toBe(403);
    expect(
      (await fetchLink(link.url.replace(/key=[^&]+/, 'key=..%2F..%2Fetc%2Fpasswd'))).status,
    ).toBe(403);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect((await fetchLink(link.url)).status).toBe(403);
    vi.useRealTimers();
    expect((await fetchLink(link.url)).status).toBe(200);
  });

  it('rejects completion when no file, or a file of the wrong size, is in storage', async () => {
    const { attorney, matter } = await setup();
    const created = (
      await post(attorney, `/v1/matters/${matter.id}/documents`, {
        title: 'X',
        filename: 'a.txt',
        contentType: 'text/plain',
        sizeBytes: 12,
      })
    ).body;
    const id = created.document.id;
    expect((await post(attorney, `/v1/documents/${id}/versions/1/complete`, {})).status).toBe(400); // nothing uploaded

    const before = new Set(storedFiles(storage.dir));
    await putBytes(app, created.upload, Buffer.from('twelve bytes')).expect(200);
    const file = storedFiles(storage.dir).find((f) => !before.has(f))!;
    expect(readFileSync(file).length).toBe(12);
    // Simulate storage holding different bytes than declared.
    (await import('node:fs')).writeFileSync(file, 'tiny');
    expect((await post(attorney, `/v1/documents/${id}/versions/1/complete`, {})).status).toBe(400);
    expect(storedFiles(storage.dir)).not.toContain(file); // mismatching object removed
  });
});

describe('permissions & lifecycle', () => {
  it('lets readers download but not write, and keeps billing out', async () => {
    const { owner, attorney, matter } = await setup();
    const staff = await addMember(app, owner, 'staff');
    const billing = await addMember(app, owner, 'billing');
    const { docId } = await uploadDocument(app, attorney, matter.id);

    expect((await download(staff, docId)).status).toBe(200);
    expect((await staff.agent.get(`/v1/matters/${matter.id}/documents`)).status).toBe(200);
    expect(
      (
        await post(staff, `/v1/matters/${matter.id}/documents`, {
          title: 'No',
          filename: 'a.txt',
          contentType: 'text/plain',
          sizeBytes: 3,
        })
      ).status,
    ).toBe(403);
    expect((await patch(staff, `/v1/documents/${docId}`, { title: 'Renamed' })).status).toBe(403);
    expect((await del(staff, `/v1/documents/${docId}`)).status).toBe(403);
    expect((await billing.agent.get(`/v1/documents/${docId}`)).status).toBe(403);
  });

  it('soft-deletes documents: hidden everywhere, bytes retained, audited', async () => {
    const { owner, attorney, matter } = await setup();
    const { docId } = await uploadDocument(app, attorney, matter.id);
    const files = storedFiles(storage.dir).length;
    await patch(attorney, `/v1/documents/${docId}`, { title: 'Renamed Doc' }).expect(200);
    await del(attorney, `/v1/documents/${docId}`).expect(204);

    expect((await attorney.agent.get(`/v1/documents/${docId}`)).status).toBe(404);
    expect((await download(attorney, docId)).status).toBe(404);
    expect(
      (await attorney.agent.get(`/v1/matters/${matter.id}/documents`).expect(200)).body.data,
    ).toHaveLength(0);
    expect(storedFiles(storage.dir).length).toBe(files);

    const actions = (await owner.agent.get('/v1/audit-logs?limit=100').expect(200)).body.data.map(
      (l: { action: string }) => l.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'document.created',
        'document.upload_requested',
        'document.upload_completed',
        'document.scan_clean',
        'document.renamed',
        'document.deleted',
      ]),
    );
  });

  it('audits every download link without recording the file name or URL', async () => {
    const { owner, attorney, matter } = await setup();
    const { docId } = await uploadDocument(app, attorney, matter.id, {
      filename: 'secret-merger-terms.txt',
    });
    await download(attorney, docId).then((r) => expect(r.status).toBe(200));
    const logs = (
      await owner.agent.get('/v1/audit-logs?action=document.download_link_issued').expect(200)
    ).body;
    expect(logs.data).toHaveLength(1);
    expect(logs.data[0]).toMatchObject({
      actorId: attorney.userId,
      targetId: docId,
      meta: { version: 1 },
    });
    expect(JSON.stringify(logs)).not.toMatch(/secret-merger|sig=/);
  });
});

describe('matter access & organization isolation', () => {
  async function restrictedSetup() {
    const s = await setup();
    const bob = await addMember(app, s.owner, 'attorney');
    const secret = await newMatter(s.attorney, s.clientId, {
      title: 'Secret Matter',
      restricted: true,
    });
    const { docId } = await uploadDocument(app, s.attorney, secret.id, {
      title: 'Privileged Memo',
    });
    return { ...s, bob, secret, docId };
  }

  it('hides documents of restricted matters from users without access', async () => {
    const { owner, attorney, bob, secret, docId } = await restrictedSetup();
    const missing = 'e'.repeat(24);

    for (const res of [
      await bob.agent.get(`/v1/matters/${secret.id}/documents`),
      await bob.agent.get(`/v1/documents/${docId}`),
      await download(bob, docId),
      await post(bob, `/v1/documents/${docId}/versions`, {
        filename: 'x.txt',
        contentType: 'text/plain',
        sizeBytes: 3,
      }),
      await post(bob, `/v1/documents/${docId}/versions/1/complete`, {}),
      await post(bob, `/v1/documents/${docId}/versions/1/rescan`, {}),
      await patch(bob, `/v1/documents/${docId}`, { title: 'Defaced Doc' }),
      await del(bob, `/v1/documents/${docId}`),
      await post(bob, `/v1/matters/${secret.id}/documents`, {
        title: 'Planted',
        filename: 'a.txt',
        contentType: 'text/plain',
        sizeBytes: 3,
      }),
    ]) {
      expect(res.status).toBe(404);
    }
    // Indistinguishable from a document that doesn't exist.
    const hidden = await bob.agent.get(`/v1/documents/${docId}`);
    const gone = await bob.agent.get(`/v1/documents/${missing}`);
    expect(hidden.body.error.message).toBe(gone.body.error.message);

    // Access list members and the (audited) owner can use them.
    expect((await download(attorney, docId)).status).toBe(200);
    expect((await download(owner, docId)).status).toBe(200);
    expect(
      (
        await owner.agent
          .get('/v1/audit-logs?action=matter.restricted_accessed_by_owner')
          .expect(200)
      ).body.data.length,
    ).toBeGreaterThan(0);
  });

  it('follows access changes immediately', async () => {
    const { owner, bob, secret, docId } = await restrictedSetup();
    await put(owner, `/v1/matters/${secret.id}/access`, {
      restricted: true,
      userIds: [bob.userId],
    }).expect(200);
    expect((await download(bob, docId)).status).toBe(200);
    await put(owner, `/v1/matters/${secret.id}/access`, { restricted: true, userIds: [] }).expect(
      200,
    );
    expect((await download(bob, docId)).status).toBe(404);
  });

  it('never shares documents across organizations', async () => {
    const a = await setup();
    const b = await registerWithMfa(app, 'Beta');
    const { docId } = await uploadDocument(app, a.attorney, a.matter.id);
    expect((await b.agent.get(`/v1/documents/${docId}`)).status).toBe(404);
    expect((await download(b as Owner, docId)).status).toBe(404);
    expect((await b.agent.get(`/v1/matters/${a.matter.id}/documents`)).status).toBe(404);
    expect(
      (
        await post(b, `/v1/matters/${a.matter.id}/documents`, {
          title: 'Planted',
          filename: 'a.txt',
          contentType: 'text/plain',
          sizeBytes: 3,
        })
      ).status,
    ).toBe(404);
    expect((await del(b, `/v1/documents/${docId}`)).status).toBe(404);
  });
});
