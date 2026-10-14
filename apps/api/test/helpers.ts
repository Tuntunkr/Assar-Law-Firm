import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { mongoose, syncIndexes } from '@assar/database';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { loadEnv, type Env } from '../src/config/env';
import { TotpService } from '../src/auth/totp.service';

export const PASSWORD = 'correct-horse-battery-1';
export const totp = new TotpService();

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI:
      process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27117/assar_test?replicaSet=rs0',
    SESSION_SECRET: 'test-session-secret-test-session-secret',
    MFA_ENCRYPTION_KEY: 'test-mfa-encryption-key-test-mfa-key',
    CORS_ORIGINS: 'http://localhost:3001',
    REGISTRATION_ENABLED: 'true',
    AUTH_RATE_LIMIT_PER_MIN: '1000',
    GLOBAL_RATE_LIMIT_PER_MIN: '100000',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

/** Boots the app against the dev replica set and starts from an empty database. */
export async function bootApp(overrides: Record<string, string> = {}): Promise<INestApplication> {
  const app = await createApp(testEnv(overrides));
  await app.init();
  await mongoose.connection.dropDatabase();
  await syncIndexes();
  return app;
}

let counter = 0;
export const uniqueEmail = (p = 'user') => `${p}${Date.now()}${counter++}@example.test`;

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  email: string;
  body: {
    csrfToken: string;
    role: string;
    user: { id: string };
    organization: { id: string };
    mfa: { enabled: boolean; enrollmentRequired: boolean };
  };
}

export async function register(app: INestApplication, name = 'Firm') {
  const agent = request.agent(app.getHttpServer());
  const email = uniqueEmail('owner');
  const res = await agent
    .post('/v1/auth/register')
    .send({ organizationName: `${name} LLP`, name: 'Olivia Owner', email, password: PASSWORD });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.csrfToken as string, email, body: res.body } as Session;
}

/** Registers an owner and completes MFA enrollment so privileged routes are reachable. */
export async function registerWithMfa(app: INestApplication, name?: string) {
  const s = await register(app, name);
  const setup = await s.agent.post('/v1/auth/mfa/setup').set('x-csrf-token', s.csrf);
  const secret = setup.body.secret as string;
  const enable = await s.agent
    .post('/v1/auth/mfa/enable')
    .set('x-csrf-token', s.csrf)
    .send({ code: totp.generate(secret) });
  if (enable.status !== 200) throw new Error(`mfa enable failed: ${enable.status}`);
  return { ...s, secret, recoveryCodes: enable.body.recoveryCodes as string[] };
}

export async function login(
  app: INestApplication,
  email: string,
  password = PASSWORD,
  mfaCode?: string,
) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post('/v1/auth/login')
    .send({ email, password, ...(mfaCode ? { mfaCode } : {}) });
  return { agent, res, csrf: res.body?.csrfToken as string };
}

export type Owner = Awaited<ReturnType<typeof registerWithMfa>>;
export interface Member {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  email: string;
  userId: string;
  role: string;
}

let keyCounter = 0;
export const idemKey = () => `test-key-${Date.now()}-${keyCounter++}-padding`;

/** Invites a user with `role`, accepts the invitation, logs in (and enrolls MFA for roles that require it). */
export async function addMember(
  app: INestApplication,
  owner: Owner,
  role: string,
): Promise<Member> {
  const email = uniqueEmail(role);
  const inv = await owner.agent
    .post('/v1/organization/invitations')
    .set('x-csrf-token', owner.csrf)
    .set('idempotency-key', idemKey())
    .send({ email, role });
  if (inv.status !== 201)
    throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  const accept = await request(app.getHttpServer())
    .post('/v1/auth/accept-invitation')
    .send({ token: inv.body.token, name: `Test ${role}`, password: PASSWORD });
  if (accept.status !== 201) throw new Error(`accept failed: ${accept.status}`);
  const { agent, res, csrf } = await login(app, email);
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  if (res.body.mfa.enrollmentRequired) {
    const setup = await agent.post('/v1/auth/mfa/setup').set('x-csrf-token', csrf);
    await agent
      .post('/v1/auth/mfa/enable')
      .set('x-csrf-token', csrf)
      .send({ code: totp.generate(setup.body.secret) })
      .expect(200);
  }
  return { agent, csrf, email, userId: res.body.user.id as string, role };
}

export const post = (m: { agent: Member['agent']; csrf: string }, url: string, body: object) =>
  m.agent.post(url).set('x-csrf-token', m.csrf).send(body);
export const patch = (m: { agent: Member['agent']; csrf: string }, url: string, body: object) =>
  m.agent.patch(url).set('x-csrf-token', m.csrf).send(body);
export const put = (m: { agent: Member['agent']; csrf: string }, url: string, body: object) =>
  m.agent.put(url).set('x-csrf-token', m.csrf).send(body);
export const del = (m: { agent: Member['agent']; csrf: string }, url: string) =>
  m.agent.delete(url).set('x-csrf-token', m.csrf);

export async function newClient(
  m: { agent: Member['agent']; csrf: string },
  name = 'Acme Holdings LLC',
) {
  const res = await post(m, '/v1/clients', { type: 'organization', name });
  if (res.status !== 201)
    throw new Error(`client failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export async function newMatter(
  m: { agent: Member['agent']; csrf: string },
  clientId: string,
  extra: object = {},
) {
  const res = await post(m, '/v1/matters', {
    clientId,
    title: 'Sample Matter',
    practiceArea: 'litigation',
    ...extra,
  });
  if (res.status !== 201)
    throw new Error(`matter failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; matterNumber: string };
}
