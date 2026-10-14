import type { INestApplication } from '@nestjs/common';
import { AuditLogModel } from '@assar/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, bootApp, login, registerWithMfa, totp, uniqueEmail } from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await app.close();
});

async function inviteAndAccept(
  owner: Awaited<ReturnType<typeof registerWithMfa>>,
  role: string,
  key: string,
) {
  const email = uniqueEmail(role);
  const inv = await owner.agent
    .post('/v1/organization/invitations')
    .set('x-csrf-token', owner.csrf)
    .set('idempotency-key', key)
    .send({ email, role })
    .expect(201);
  await owner.agent
    .post('/v1/auth/accept-invitation')
    .send({ token: inv.body.token, name: `New ${role}`, password: PASSWORD })
    .expect(201);
  const session = await login(app, email);
  expect(session.res.status).toBe(200);
  return { ...session, email };
}

describe('invitations & members', () => {
  it('invites, accepts and logs in a new team member', async () => {
    const owner = await registerWithMfa(app);
    const member = await inviteAndAccept(owner, 'attorney', 'invite-key-attorney-1');
    expect(member.res.body.role).toBe('attorney');
    expect(member.res.body.permissions).toContain('matter:write');

    const list = await owner.agent.get('/v1/organization/members').expect(200);
    expect(list.body.data.map((m: { email: string }) => m.email)).toContain(member.email);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|secretEnc/);
  });

  it('does not let an invitation token be used twice', async () => {
    const owner = await registerWithMfa(app);
    const email = uniqueEmail('once');
    const inv = await owner.agent
      .post('/v1/organization/invitations')
      .set('x-csrf-token', owner.csrf)
      .set('idempotency-key', 'invite-key-once-0001')
      .send({ email, role: 'staff' })
      .expect(201);
    const body = { token: inv.body.token, name: 'Once', password: PASSWORD };
    await owner.agent.post('/v1/auth/accept-invitation').send(body).expect(201);
    await owner.agent.post('/v1/auth/accept-invitation').send(body).expect(404);
  });

  it('is idempotent: replays the stored response without the token', async () => {
    const owner = await registerWithMfa(app);
    const payload = { email: uniqueEmail('idem'), role: 'paralegal' };
    const post = (b = payload) =>
      owner.agent
        .post('/v1/organization/invitations')
        .set('x-csrf-token', owner.csrf)
        .set('idempotency-key', 'idem-key-12345678')
        .send(b);
    const first = await post().expect(201);
    const second = await post().expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.token).toBeUndefined();
    const mismatch = await post({ ...payload, role: 'staff' });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_MISMATCH');

    const pending = await owner.agent.get('/v1/organization/invitations').expect(200);
    expect(
      pending.body.data.filter((i: { email: string }) => i.email === payload.email),
    ).toHaveLength(1);
  });

  it('requires an Idempotency-Key on invitations', async () => {
    const owner = await registerWithMfa(app);
    await owner.agent
      .post('/v1/organization/invitations')
      .set('x-csrf-token', owner.csrf)
      .send({ email: uniqueEmail(), role: 'staff' })
      .expect(400);
  });

  it('enforces role permissions', async () => {
    const owner = await registerWithMfa(app);
    const attorney = await inviteAndAccept(owner, 'attorney', 'invite-key-perm-0001');
    await attorney.agent.get('/v1/organization').expect(200);
    await attorney.agent.get('/v1/organization/members').expect(403);
    await attorney.agent.get('/v1/audit-logs').expect(403);
    await attorney.agent
      .patch('/v1/organization')
      .set('x-csrf-token', attorney.csrf)
      .send({ name: 'Hijacked' })
      .expect(403);
  });

  it('lets only the owner manage administrators', async () => {
    const owner = await registerWithMfa(app);
    const admin = await inviteAndAccept(owner, 'admin', 'invite-key-admin-001');
    // Admins require MFA before privileged routes work.
    expect((await admin.agent.get('/v1/organization/members')).body.error.code).toBe(
      'MFA_ENROLLMENT_REQUIRED',
    );
    const setup = await admin.agent.post('/v1/auth/mfa/setup').set('x-csrf-token', admin.csrf);
    await admin.agent
      .post('/v1/auth/mfa/enable')
      .set('x-csrf-token', admin.csrf)
      .send({ code: totp.generate(setup.body.secret) })
      .expect(200);

    await admin.agent
      .post('/v1/organization/invitations')
      .set('x-csrf-token', admin.csrf)
      .set('idempotency-key', 'admin-invites-admin-1')
      .send({ email: uniqueEmail(), role: 'admin' })
      .expect(403);
  });

  it('disabling a member revokes their sessions', async () => {
    const owner = await registerWithMfa(app);
    const staff = await inviteAndAccept(owner, 'staff', 'invite-key-staff-0001');
    await staff.agent.get('/v1/auth/me').expect(200);
    const userId = staff.res.body.user.id;
    await owner.agent
      .patch(`/v1/organization/members/${userId}`)
      .set('x-csrf-token', owner.csrf)
      .send({ status: 'disabled' })
      .expect(200);
    await staff.agent.get('/v1/auth/me').expect(401);
    expect((await login(app, staff.email)).res.status).toBe(401);
  });

  it('protects owners and self-modification', async () => {
    const owner = await registerWithMfa(app);
    const me = owner.body.user.id;
    await owner.agent
      .patch(`/v1/organization/members/${me}`)
      .set('x-csrf-token', owner.csrf)
      .send({ role: 'staff' })
      .expect(403);
  });
});

describe('organization isolation', () => {
  it('never exposes another organization’s members, invitations or audit logs', async () => {
    const a = await registerWithMfa(app, 'Alpha');
    const b = await registerWithMfa(app, 'Beta');
    const bMember = await inviteAndAccept(b, 'staff', 'invite-key-beta-0001');

    // A cannot touch B's user by guessing the id.
    await a.agent
      .patch(`/v1/organization/members/${bMember.res.body.user.id}`)
      .set('x-csrf-token', a.csrf)
      .send({ status: 'disabled' })
      .expect(404);
    await a.agent.get('/v1/auth/me').expect(200);
    expect((await login(app, bMember.email)).res.status).toBe(200); // still active

    const members = await a.agent.get('/v1/organization/members').expect(200);
    expect(members.body.data.map((m: { email: string }) => m.email)).not.toContain(bMember.email);
    expect((await a.agent.get('/v1/organization/invitations').expect(200)).body.data).toHaveLength(
      0,
    );

    const logs = await a.agent.get('/v1/audit-logs').expect(200);
    const orgAId = a.body.organization.id;
    expect(logs.body.data.length).toBeGreaterThan(0);
    const rows = await AuditLogModel.find({
      _id: { $in: logs.body.data.map((l: { id: string }) => l.id) },
    }).lean();
    expect(rows.every((r) => String(r.organizationId) === orgAId)).toBe(true);
  });
});

describe('audit log', () => {
  it('records security events, paginates, and is append-only', async () => {
    const owner = await registerWithMfa(app);
    // Two failed logins add events beyond the registration/MFA ones.
    await login(app, owner.email, 'wrong-password-123');
    await login(app, owner.email, 'wrong-password-456');
    const first = await owner.agent.get('/v1/audit-logs?limit=2').expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.page.nextCursor).toBeTruthy();
    const next = await owner.agent
      .get(`/v1/audit-logs?limit=2&cursor=${first.body.page.nextCursor}`)
      .expect(200);
    expect(next.body.data[0].id).not.toBe(first.body.data[0].id);
    await owner.agent.get('/v1/audit-logs?cursor=garbage').expect(400);

    const actions = (await owner.agent.get('/v1/audit-logs?limit=100').expect(200)).body.data.map(
      (l: { action: string }) => l.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['organization.created', 'auth.mfa_enabled']));
    await expect(AuditLogModel.updateOne({}, { action: 'tampered' })).rejects.toThrow(
      /append-only/,
    );
    await expect(AuditLogModel.deleteMany({})).rejects.toThrow(/append-only/);
  });
});
