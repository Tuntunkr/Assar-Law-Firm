import type { INestApplication } from '@nestjs/common';
import { AiOutputModel, ClientUserModel, mongoose } from '@assar/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EICAR,
  PASSWORD,
  addMember,
  bootApp,
  cookieValue,
  del,
  envOf,
  newClient,
  newMatter,
  patch,
  portalLogin,
  portalPost,
  portalUser,
  post,
  put,
  registerWithMfa,
  settle,
  startFakeClamd,
  startFakeGrok,
  startTestWorkers,
  tempStorageDir,
  uniqueEmail,
  uploadDocument,
  waitUntil,
  type TestWorkers,
} from './helpers';

let app: INestApplication;
let clamd: Awaited<ReturnType<typeof startFakeClamd>>;
let grok: Awaited<ReturnType<typeof startFakeGrok>>;
let workers: TestWorkers;
const storage = tempStorageDir();

beforeAll(async () => {
  clamd = await startFakeClamd();
  grok = await startFakeGrok();
  app = await bootApp({
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: storage.dir,
    PUBLIC_API_URL: 'http://api.test',
    AI_ENABLED: 'true',
  });
  workers = startTestWorkers(envOf(app), { clamdPort: clamd.port, grokUrl: grok.url });
});
afterAll(async () => {
  await workers.close();
  await app.close();
  await grok.close();
  await clamd.close();
  storage.cleanup();
});

const ORG_ONLY = 'INTERNAL-ONLY description that a client must never see';

/** A firm with two clients; each has a published matter, and client A also has an unpublished one. */
async function firm() {
  const owner = await registerWithMfa(app);
  const slug = owner.body.organization.slug as string;
  const attorney = await addMember(app, owner, 'attorney');
  const paralegal = await addMember(app, owner, 'paralegal');
  const staff = await addMember(app, owner, 'staff');
  const clientA = await newClient(owner, 'Acme Holdings LLC');
  const clientB = await newClient(owner, 'Beta Supplies Ltd');
  const mA1 = await newMatter(attorney, clientA, {
    title: 'Acme Lease Dispute',
    description: ORG_ONLY,
  });
  const mA2 = await newMatter(attorney, clientA, { title: 'Acme Internal Review (unpublished)' });
  const mB1 = await newMatter(attorney, clientB, { title: 'Beta Contract' });
  await put(attorney, `/v1/matters/${mA1.id}/portal`, {
    visible: true,
    note: 'Hearing next month; we will update you.',
  }).expect(200);
  await put(attorney, `/v1/matters/${mB1.id}/portal`, { visible: true }).expect(200);
  const a = await portalUser(app, attorney, slug, clientA);
  const b = await portalUser(app, attorney, slug, clientB);
  return { owner, slug, attorney, paralegal, staff, clientA, clientB, mA1, mA2, mB1, a, b };
}
const idsOf = (res: { body: { data: { id: string }[] } }) => res.body.data.map((m) => m.id);

describe('portal sign-in', () => {
  it('lets staff with portal:manage invite a client contact, who accepts once and signs in', async () => {
    const { attorney, paralegal, staff, slug, clientA } = await firm();
    expect(
      (await post(paralegal, `/v1/clients/${clientA}/portal-invitations`, { email: uniqueEmail() }))
        .status,
    ).toBe(403);
    expect(
      (await post(staff, `/v1/clients/${clientA}/portal-invitations`, { email: uniqueEmail() }))
        .status,
    ).toBe(403);

    const email = uniqueEmail('contact');
    const inv = await post(attorney, `/v1/clients/${clientA}/portal-invitations`, {
      email,
      name: 'Pat Contact',
    }).expect(201);
    const accept = { token: inv.body.token, name: 'Pat Contact', password: PASSWORD };
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/portal/auth/accept-invitation')
          .send({ ...accept, password: 'short' })
      ).status,
    ).toBe(400);
    await request(app.getHttpServer())
      .post('/v1/portal/auth/accept-invitation')
      .send(accept)
      .expect(201);
    expect(
      (await request(app.getHttpServer()).post('/v1/portal/auth/accept-invitation').send(accept))
        .status,
    ).toBe(404); // single use
    expect(
      (await post(attorney, `/v1/clients/${clientA}/portal-invitations`, { email })).status,
    ).toBe(409); // already has access

    const login = await portalLogin(app, slug, email);
    expect(login.res.status).toBe(200);
    expect(login.res.body).toMatchObject({
      clientUser: { email, name: 'Pat Contact' },
      client: { name: 'Acme Holdings LLC' },
      organization: { slug },
    });
    const cookies = (login.res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies).toMatch(/assar_portal_sid=[^;]+;.*HttpOnly/i);
    expect(cookies).not.toMatch(/assar_sid=/); // a different cookie from staff sessions
    expect(JSON.stringify(login.res.body)).not.toMatch(/passwordHash|\$argon2|clientId/);

    const access = await attorney.agent.get(`/v1/clients/${clientA}/portal-access`).expect(200);
    expect(access.body.users.map((u: { email: string }) => u.email)).toContain(email);
    expect(access.body.invitations).toEqual([]);
  });

  it('gives the same generic failure for a wrong firm, email or password, and locks after repeated failures', async () => {
    const { a, slug } = await firm();
    const wrongPw = await portalLogin(app, slug, a.email, 'not-the-password-1');
    const wrongFirm = await portalLogin(app, 'no-such-firm', a.email);
    const wrongEmail = await portalLogin(app, slug, uniqueEmail('ghost'));
    expect([wrongPw.res.status, wrongFirm.res.status, wrongEmail.res.status]).toEqual([
      401, 401, 401,
    ]);
    expect(
      new Set([wrongPw, wrongFirm, wrongEmail].map((r) => r.res.body.error.message)).size,
    ).toBe(1);

    for (let i = 0; i < 4; i++) await portalLogin(app, slug, a.email, 'not-the-password-1');
    const locked = await portalLogin(app, slug, a.email);
    expect(locked.res.status).toBe(429);
    expect(locked.res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('does not let a portal user sign in to a firm they do not belong to', async () => {
    const f = await firm();
    const other = await registerWithMfa(app, 'Other');
    expect((await portalLogin(app, other.body.organization.slug, f.a.email)).res.status).toBe(401);
  });

  it('cuts off access immediately when a portal user is disabled or the client is archived', async () => {
    const { attorney, owner, slug, clientA, a } = await firm();
    await a.agent.get('/v1/portal/matters').expect(200);
    const userId = (await a.agent.get('/v1/portal/me').expect(200)).body.clientUser.id;
    await request(app.getHttpServer())
      .patch(`/v1/clients/${clientA}/portal-users/${userId}`)
      .set('Cookie', '')
      .send({ status: 'disabled' })
      .expect(401);
    await patch(attorney, `/v1/clients/${clientA}/portal-users/${userId}`, {
      status: 'disabled',
    }).expect(200);
    await a.agent.get('/v1/portal/matters').expect(401); // existing session revoked
    expect((await portalLogin(app, slug, a.email)).res.status).toBe(401);
    await patch(attorney, `/v1/clients/${clientA}/portal-users/${userId}`, {
      status: 'active',
    }).expect(200);
    const back = await portalLogin(app, slug, a.email);
    expect(back.res.status).toBe(200);

    await patch(owner, `/v1/clients/${clientA}`, { status: 'archived' }).expect(200);
    await back.agent.get('/v1/portal/matters').expect(401); // archived client: sessions stop working
    expect((await portalLogin(app, slug, a.email)).res.status).toBe(401);
  });

  it('requires CSRF protection and rejects untrusted origins', async () => {
    const { a } = await firm();
    await a.agent.post('/v1/portal/auth/logout').expect(403);
    await a.agent.post('/v1/portal/auth/logout').set('x-csrf-token', 'wrong').expect(403);
    await a.agent
      .post('/v1/portal/auth/logout')
      .set('x-csrf-token', a.csrf)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await a.agent.post('/v1/portal/auth/logout').set('x-csrf-token', a.csrf).expect(204);
    await a.agent.get('/v1/portal/me').expect(401);
  });

  it('changes passwords and ends other sessions', async () => {
    const { a, slug } = await firm();
    const second = await portalLogin(app, slug, a.email);
    await portalPost(a, '/v1/portal/auth/change-password', {
      currentPassword: 'wrong-current-password',
      newPassword: 'another-long-passphrase-2',
    }).expect(403);
    await portalPost(a, '/v1/portal/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'another-long-passphrase-2',
    }).expect(204);
    await second.agent.get('/v1/portal/me').expect(401);
    await a.agent.get('/v1/portal/me').expect(200);
    expect((await portalLogin(app, slug, a.email, 'another-long-passphrase-2')).res.status).toBe(
      200,
    );
  });
});

describe('principals cannot cross', () => {
  it('keeps portal sessions out of staff routes, staff sessions out of the portal, and tokens out of both', async () => {
    const { owner, a } = await firm();
    // A client's cookies do nothing on staff endpoints...
    await a.agent.get('/v1/auth/me').expect(401);
    await a.agent.get('/v1/matters').expect(401);
    await a.agent.get('/v1/clients').expect(401);
    // ...and a staff session does nothing on portal endpoints.
    await owner.agent.get('/v1/portal/me').expect(401);
    await owner.agent.get('/v1/portal/matters').expect(401);

    // Even with the raw token moved into the other cookie name.
    const portalRaw = cookieValue(a.agent, 'assar_portal_sid')!;
    const staffRaw = cookieValue(owner.agent, 'assar_sid')!;
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Cookie', `assar_sid=${portalRaw}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/v1/portal/me')
      .set('Cookie', `assar_portal_sid=${staffRaw}`)
      .expect(401);
    // A portal CSRF token is not a staff CSRF token.
    await owner.agent
      .post('/v1/organization/invitations')
      .set('x-csrf-token', a.csrf)
      .set('idempotency-key', 'portal-csrf-0001')
      .send({ email: uniqueEmail(), role: 'staff' })
      .expect(403);
  });
});

describe('what a client can see', () => {
  it('shows only published matters of their own client, and nothing else', async () => {
    const { a, b, mA1, mA2, mB1 } = await firm();
    const mine = await a.agent.get('/v1/portal/matters').expect(200);
    expect(idsOf(mine)).toEqual([mA1.id]);
    expect(mine.body.data[0]).toEqual({
      id: mA1.id,
      matterNumber: mA1.matterNumber,
      title: 'Acme Lease Dispute',
      practiceArea: 'litigation',
      status: 'open',
      note: 'Hearing next month; we will update you.',
      openedAt: expect.any(String),
      closedAt: null,
    });
    expect(idsOf(await b.agent.get('/v1/portal/matters').expect(200))).toEqual([mB1.id]);

    // Unpublished and other clients' matters are indistinguishable from nonexistent ones.
    const missing = await a.agent.get(`/v1/portal/matters/${'e'.repeat(24)}`);
    for (const id of [mA2.id, mB1.id]) {
      const r = await a.agent.get(`/v1/portal/matters/${id}`);
      expect(r.status).toBe(404);
      expect(r.body.error.message).toBe(missing.body.error.message);
      expect((await a.agent.get(`/v1/portal/matters/${id}/documents`)).status).toBe(404);
      expect((await a.agent.get(`/v1/portal/matters/${id}/ai-outputs`)).status).toBe(404);
    }
  });

  it('never exposes internal fields', async () => {
    const { a, mA1 } = await firm();
    const bodies = JSON.stringify([
      (await a.agent.get('/v1/portal/matters')).body,
      (await a.agent.get(`/v1/portal/matters/${mA1.id}`)).body,
      (await a.agent.get('/v1/portal/me')).body,
    ]);
    expect(bodies).not.toContain(ORG_ONLY);
    expect(bodies).not.toMatch(
      /restricted|leadAttorney|teamIds|createdBy|portalVisible|description/,
    );
  });

  it('follows publishing and unpublishing at once', async () => {
    const { attorney, a, mA1, mA2 } = await firm();
    await put(attorney, `/v1/matters/${mA2.id}/portal`, { visible: true }).expect(200);
    expect(idsOf(await a.agent.get('/v1/portal/matters').expect(200)).sort()).toEqual(
      [mA1.id, mA2.id].sort(),
    );
    await put(attorney, `/v1/matters/${mA1.id}/portal`, { visible: false }).expect(200);
    expect(idsOf(await a.agent.get('/v1/portal/matters').expect(200))).toEqual([mA2.id]);
    await a.agent.get(`/v1/portal/matters/${mA1.id}`).expect(404);
  });

  it('shows only shared, scanned document versions and serves them through short-lived links', async () => {
    const { attorney, a, b, mA1, mB1 } = await firm();
    const shared = await uploadDocument(app, attorney, mA1.id, {
      title: 'Signed Lease',
      filename: 'lease.txt',
      content: 'lease text',
    });
    const priv = await uploadDocument(app, attorney, mA1.id, {
      title: 'Privileged Strategy Memo',
      filename: 'memo.txt',
      content: 'secret strategy',
    });
    const multi = await uploadDocument(app, attorney, mA1.id, {
      title: 'Draft Letter',
      filename: 'v1.txt',
      content: 'first draft',
    });
    await post(attorney, `/v1/documents/${multi.docId}/versions`, {
      filename: 'v2.txt',
      contentType: 'text/plain',
      sizeBytes: 5,
    }).expect(201); // v2 never uploaded
    const other = await uploadDocument(app, attorney, mB1.id, {
      title: 'Beta Document',
      content: 'beta only',
    });
    for (const [d, v] of [
      [shared.docId, 1],
      [multi.docId, 1],
      [other.docId, 1],
    ] as const)
      await put(attorney, `/v1/documents/${d}/versions/${v}/share`, { shared: true }).expect(200);

    const list = await a.agent.get(`/v1/portal/matters/${mA1.id}/documents`).expect(200);
    expect(list.body.data.map((d: { title: string }) => d.title).sort()).toEqual([
      'Draft Letter',
      'Signed Lease',
    ]);
    expect(
      list.body.data.find((d: { title: string }) => d.title === 'Draft Letter').versions,
    ).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(
      /Privileged|memo\.txt|org\/[a-f0-9]{24}\/matter|storageKey|scan/,
    );

    const link = await portalPost(
      a,
      `/v1/portal/documents/${shared.docId}/versions/1/download-link`,
    ).expect(200);
    expect(new Date(link.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    const u = new URL(link.body.url);
    const file = await request(app.getHttpServer())
      .get(u.pathname + u.search)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.body.toString()).toBe('lease text');
    expect(file.headers['content-disposition']).toMatch(/attachment; filename="lease.txt"/);

    // Not shared, not uploaded, other client's, nonexistent: all the same 404.
    for (const [d, v] of [
      [priv.docId, 1],
      [multi.docId, 2],
      [other.docId, 1],
      ['d'.repeat(24), 1],
      [shared.docId, 9],
    ] as const) {
      expect(
        (await portalPost(a, `/v1/portal/documents/${d}/versions/${v}/download-link`)).status,
      ).toBe(404);
    }
    expect(
      (await portalPost(b, `/v1/portal/documents/${shared.docId}/versions/1/download-link`)).status,
    ).toBe(404); // other client
    expect((await b.agent.get(`/v1/portal/matters/${mA1.id}/documents`)).status).toBe(404);

    // Unsharing and unpublishing take effect immediately.
    await put(attorney, `/v1/documents/${shared.docId}/versions/1/share`, { shared: false }).expect(
      200,
    );
    expect(
      (await portalPost(a, `/v1/portal/documents/${shared.docId}/versions/1/download-link`)).status,
    ).toBe(404);
    await put(attorney, `/v1/matters/${mA1.id}/portal`, { visible: false }).expect(200);
    expect(
      (await portalPost(a, `/v1/portal/documents/${multi.docId}/versions/1/download-link`)).status,
    ).toBe(404);
    await del(attorney, `/v1/documents/${multi.docId}`).expect(204);
  });

  it('refuses to share unscanned or infected versions, and requires portal:manage to share', async () => {
    const { attorney, paralegal, mA1 } = await firm();
    const infected = await uploadDocument(app, attorney, mA1.id, {
      filename: 'bad.txt',
      content: EICAR,
    });
    const ok = await uploadDocument(app, attorney, mA1.id, { filename: 'ok.txt', content: 'fine' });
    const pending = (
      await post(attorney, `/v1/matters/${mA1.id}/documents`, {
        title: 'Not uploaded',
        filename: 'a.txt',
        contentType: 'text/plain',
        sizeBytes: 4,
      })
    ).body.document.id;

    expect(
      (await put(attorney, `/v1/documents/${infected.docId}/versions/1/share`, { shared: true }))
        .status,
    ).toBe(409);
    expect(
      (await put(attorney, `/v1/documents/${pending}/versions/1/share`, { shared: true })).status,
    ).toBe(409);
    expect(
      (await put(paralegal, `/v1/documents/${ok.docId}/versions/1/share`, { shared: true })).status,
    ).toBe(403);
    expect((await put(paralegal, `/v1/matters/${mA1.id}/portal`, { visible: false })).status).toBe(
      403,
    );
    expect(
      (await put(attorney, `/v1/documents/${ok.docId}/versions/1/share`, { shared: true })).status,
    ).toBe(200);
  });

  it('shows only AI outputs that were approved AND shared, with an allow-listed shape', async () => {
    const { owner, a, b, mA1 } = await firm();
    const mk = (over: object) =>
      AiOutputModel.create({
        organizationId: owner.body.organization.id,
        matterId: mA1.id,
        jobId: new mongoose.Types.ObjectId(),
        task: 'summary',
        requestedBy: owner.body.user.id,
        result: {
          title: 'Lease summary',
          body: 'The lease runs for twelve months.',
          items: [
            { label: 'Key point', text: 'Twelve month term', verified: true },
            { label: 'Key point', text: 'UNVERIFIED claim about penalties', verified: false },
          ],
          verification: {
            status: 'partially_verified',
            unsupportedAuthorities: ['Smith v. Jones'],
          },
        },
        sources: [{ sourceId: 'S1', filename: 'internal-source.txt' }],
        model: 'internal-model-name',
        reviewNote: 'INTERNAL reviewer note',
        reviewedBy: owner.body.user.id,
        reviewedAt: new Date(),
        ...over,
      });
    const shown = await mk({ reviewStatus: 'approved', sharedWithClient: true });
    const approvedOnly = await mk({ reviewStatus: 'approved', sharedWithClient: false });
    const draft = await mk({ reviewStatus: 'draft', sharedWithClient: true }); // inconsistent data must still be hidden
    const rejected = await mk({ reviewStatus: 'rejected', sharedWithClient: true });
    const edited = await mk({
      reviewStatus: 'approved',
      sharedWithClient: true,
      editedText: 'Reviewer-written explanation for the client.',
    });

    const list = await a.agent.get(`/v1/portal/matters/${mA1.id}/ai-outputs`).expect(200);
    expect(idsOf(list).sort()).toEqual([String(shown._id), String(edited._id)].sort());
    const one = list.body.data.find((o: { id: string }) => o.id === String(shown._id));
    expect(one).toEqual({
      id: String(shown._id),
      matterId: mA1.id,
      task: 'summary',
      title: 'Lease summary',
      body: 'The lease runs for twelve months.',
      points: [{ label: 'Key point', text: 'Twelve month term' }],
      label: 'Prepared with AI assistance and reviewed and approved by your legal team.',
      approvedAt: expect.any(String),
    });
    expect(list.body.data.find((o: { id: string }) => o.id === String(edited._id))).toMatchObject({
      body: 'Reviewer-written explanation for the client.',
      points: [],
    });
    expect(JSON.stringify(list.body)).not.toMatch(
      /UNVERIFIED|Smith v\. Jones|internal-source|internal-model|INTERNAL reviewer|verification|sources|model|reviewNote/,
    );

    for (const o of [approvedOnly, draft, rejected])
      expect((await a.agent.get(`/v1/portal/ai-outputs/${o._id}`)).status).toBe(404);
    expect((await a.agent.get(`/v1/portal/ai-outputs/${shown._id}`).expect(200)).body.id).toBe(
      String(shown._id),
    );
    expect((await b.agent.get(`/v1/portal/ai-outputs/${shown._id}`)).status).toBe(404); // another client
  });

  it('takes an AI draft through approval and sharing before a client can see it', async () => {
    const { attorney, paralegal, a, mA1 } = await firm();
    const { docId } = await uploadDocument(app, attorney, mA1.id, {
      filename: 'agreement.txt',
      content: 'This Agreement is made on 12 March 2024.\nThe term is twelve months.',
    });
    const job = await post(paralegal, '/v1/ai/jobs', {
      task: 'summary',
      matterId: mA1.id,
      documents: [{ documentId: docId }],
    }).expect(202);
    const done = await waitUntil(
      () => paralegal.agent.get(`/v1/ai/jobs/${job.body.id}`).then((r) => r.body),
      (j) => j.status === 'succeeded',
    );
    const outId = done.outputId as string;

    expect((await a.agent.get(`/v1/portal/ai-outputs/${outId}`)).status).toBe(404); // a draft
    expect((await put(attorney, `/v1/ai/outputs/${outId}/share`, { shared: true })).status).toBe(
      409,
    ); // not approved yet
    await post(attorney, `/v1/ai/outputs/${outId}/approve`, {}).expect(200);
    expect((await a.agent.get(`/v1/portal/ai-outputs/${outId}`)).status).toBe(404); // approved is not shared
    expect((await put(paralegal, `/v1/ai/outputs/${outId}/share`, { shared: true })).status).toBe(
      403,
    );
    await put(attorney, `/v1/ai/outputs/${outId}/share`, { shared: true }).expect(200);
    const seen = await a.agent.get(`/v1/portal/ai-outputs/${outId}`).expect(200);
    expect(seen.body.label).toMatch(/reviewed and approved by your legal team/);
    await put(attorney, `/v1/ai/outputs/${outId}/share`, { shared: false }).expect(200);
    expect((await a.agent.get(`/v1/portal/ai-outputs/${outId}`)).status).toBe(404);
    await settle(app, { ai: true });
  });
});

describe('auditing & isolation between firms', () => {
  it('records client activity with the client as the actor', async () => {
    const { owner, attorney, a, mA1 } = await firm();
    const doc = await uploadDocument(app, attorney, mA1.id, { content: 'audited' });
    await put(attorney, `/v1/documents/${doc.docId}/versions/1/share`, { shared: true }).expect(
      200,
    );
    await portalPost(a, `/v1/portal/documents/${doc.docId}/versions/1/download-link`).expect(200);
    const logs = (await owner.agent.get('/v1/audit-logs?limit=100').expect(200)).body.data as {
      action: string;
      actorType: string;
      actorId: string;
    }[];
    const dl = logs.find((l) => l.action === 'portal.document_downloaded')!;
    expect(dl.actorType).toBe('client');
    expect(logs.find((l) => l.action === 'portal.login')!.actorType).toBe('client');
    expect(logs.find((l) => l.action === 'document.shared_with_client')!.actorType).toBe('staff');
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining([
        'matter.published_to_portal',
        'portal.invitation_created',
        'portal.invitation_accepted',
      ]),
    );
    expect(JSON.stringify(logs)).not.toMatch(/sig=|lease\.txt/);
  });

  it('keeps firms apart: portal users, matters and staff toggles never cross organizations', async () => {
    const f = await firm();
    const g = await firm();
    expect(idsOf(await g.a.agent.get('/v1/portal/matters').expect(200))).toEqual([g.mA1.id]);
    expect((await g.a.agent.get(`/v1/portal/matters/${f.mA1.id}`)).status).toBe(404);

    // Staff in firm G can't publish, share or administer anything in firm F.
    expect(
      (await put(g.attorney, `/v1/matters/${f.mA1.id}/portal`, { visible: false })).status,
    ).toBe(404);
    expect(
      (
        await post(g.attorney, `/v1/clients/${f.clientA}/portal-invitations`, {
          email: uniqueEmail(),
        })
      ).status,
    ).toBe(404);
    expect((await g.attorney.agent.get(`/v1/clients/${f.clientA}/portal-access`)).status).toBe(404);
    const userId = (await f.a.agent.get('/v1/portal/me')).body.clientUser.id;
    expect(
      (
        await patch(g.attorney, `/v1/clients/${g.clientA}/portal-users/${userId}`, {
          status: 'disabled',
        })
      ).status,
    ).toBe(404);
    await f.a.agent.get('/v1/portal/matters').expect(200); // still fine
    expect((await ClientUserModel.findById(userId).lean())!.status).toBe('active');
  });

  it('keeps restricted matters publishable only by staff who can see them', async () => {
    const { owner, attorney, paralegal, clientA, slug } = await firm();
    const secret = await newMatter(attorney, clientA, { title: 'Walled Matter', restricted: true });
    const bob = await addMember(app, owner, 'attorney');
    expect((await put(bob, `/v1/matters/${secret.id}/portal`, { visible: true })).status).toBe(404); // portal:manage but no access
    expect(
      (await put(paralegal, `/v1/matters/${secret.id}/portal`, { visible: true })).status,
    ).toBe(403);
    await put(attorney, `/v1/matters/${secret.id}/portal`, { visible: true }).expect(200); // the creator can
    const c = await portalUser(app, attorney, slug, clientA);
    expect(idsOf(await c.agent.get('/v1/portal/matters').expect(200))).toContain(secret.id);
  });
});
