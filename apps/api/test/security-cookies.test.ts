import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, bootApp, totp, uniqueEmail } from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp({ COOKIE_SECURE: 'true' });
});
afterAll(async () => {
  await app.close();
});

/** A minimal cookie jar that, unlike a browser, will send Secure cookies over plain HTTP (the test has no TLS). */
function browser() {
  const jar = new Map<string, string>();
  const raw: string[] = [];
  const send = async (
    method: 'get' | 'post',
    url: string,
    body?: object,
    headers: Record<string, string> = {},
  ) => {
    let r = request(app.getHttpServer())[method](url);
    if (jar.size) r = r.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    const res = await (body ? r.send(body) : r);
    for (const c of (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []) {
      raw.push(c);
      const [pair] = c.split(';');
      const [name, ...v] = pair!.split('=');
      if (/Expires=Thu, 01 Jan 1970/i.test(c) || v.join('=') === '') jar.delete(name!);
      else jar.set(name!, v.join('='));
    }
    return res;
  };
  return { jar, raw, send };
}

describe('Secure cookies use the __Host- prefix', () => {
  it('sets staff session cookies that browsers will only accept from this exact host', async () => {
    const b = browser();
    const res = await b.send('post', '/v1/auth/register', {
      organizationName: 'Cookie LLP',
      name: 'Cookie Owner',
      email: uniqueEmail(),
      password: PASSWORD,
    });
    expect(res.status).toBe(201);

    const session = b.raw.find((c) => c.startsWith('__Host-assar_sid='))!;
    const csrf = b.raw.find((c) => c.startsWith('__Host-assar_csrf='))!;
    for (const c of [session, csrf]) {
      expect(c).toMatch(/; Secure/);
      expect(c).toMatch(/; Path=\//);
      expect(c).toMatch(/; SameSite=Lax/);
      expect(c).not.toMatch(/Domain=/i); // required by the __Host- prefix
    }
    expect(session).toMatch(/; HttpOnly/);
    expect(csrf).not.toMatch(/HttpOnly/); // the SPA must read this one
    expect(b.raw.some((c) => /^assar_(sid|csrf)=/.test(c))).toBe(false); // no unprefixed twins

    expect((await b.send('get', '/v1/auth/me')).status).toBe(200);
  });

  it('ignores a cookie that arrives without the prefix (e.g. planted by another subdomain)', async () => {
    const b = browser();
    await b.send('post', '/v1/auth/register', {
      organizationName: 'Tossing LLP',
      name: 'Toss Owner',
      email: uniqueEmail(),
      password: PASSWORD,
    });
    const token = b.jar.get('__Host-assar_sid')!;
    const planted = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Cookie', `assar_sid=${token}`);
    expect(planted.status).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .get('/v1/auth/me')
          .set('Cookie', `__Host-assar_sid=${token}`)
      ).status,
    ).toBe(200);
  });

  it('clears the prefixed cookies on sign-out', async () => {
    const b = browser();
    const reg = await b.send('post', '/v1/auth/register', {
      organizationName: 'Signout LLP',
      name: 'Out Owner',
      email: uniqueEmail(),
      password: PASSWORD,
    });
    const out = await b.send('post', '/v1/auth/logout', {}, { 'x-csrf-token': reg.body.csrfToken });
    expect(out.status).toBe(204);
    const setCookies = out.headers['set-cookie'] as unknown as string[];
    const cleared = setCookies.join(' ');
    expect(cleared).toMatch(/__Host-assar_sid=;/);
    expect(cleared).toMatch(/__Host-assar_csrf=;/);
    // Browsers ignore a __Host- Set-Cookie (including a deletion) that is not Secure with Path=/ and no Domain.
    for (const name of ['__Host-assar_sid=', '__Host-assar_csrf=']) {
      const c = setCookies.find((x) => x.startsWith(name))!;
      expect(c).toMatch(/; Secure/);
      expect(c).toMatch(/; Path=\//);
      expect(c).not.toMatch(/Domain=/i);
      expect(c).toMatch(/Expires=Thu, 01 Jan 1970/i);
    }
    expect((await b.send('get', '/v1/auth/me')).status).toBe(401);
  });

  it('applies the same protection to client-portal cookies', async () => {
    const staff = browser();
    const email = uniqueEmail('owner');
    const reg = await staff.send('post', '/v1/auth/register', {
      organizationName: 'Portal Cookie LLP',
      name: 'Portal Owner',
      email,
      password: PASSWORD,
    });
    const slug = reg.body.organization.slug as string;
    const h = () => ({ 'x-csrf-token': reg.body.csrfToken });
    // The owner must enroll in MFA before using privileged routes.
    const setup = await staff.send('post', '/v1/auth/mfa/setup', {}, h());
    await staff.send(
      'post',
      '/v1/auth/mfa/enable',
      { code: totp.generate(setup.body.secret) },
      h(),
    );
    const client = await staff.send(
      'post',
      '/v1/clients',
      { type: 'organization', name: 'Cookie Client LLC' },
      h(),
    );
    const cEmail = uniqueEmail('client');
    const inv = await staff.send(
      'post',
      `/v1/clients/${client.body.id}/portal-invitations`,
      { email: cEmail },
      h(),
    );
    expect(inv.status).toBe(201);
    await request(app.getHttpServer())
      .post('/v1/portal/auth/accept-invitation')
      .send({ token: inv.body.token, name: 'Pat Client', password: PASSWORD })
      .expect(201);

    const c = browser();
    const login = await c.send('post', '/v1/portal/auth/login', {
      organizationSlug: slug,
      email: cEmail,
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    const sid = c.raw.find((x) => x.startsWith('__Host-assar_portal_sid='))!;
    expect(sid).toMatch(/; Secure/);
    expect(sid).toMatch(/; HttpOnly/);
    expect(sid).not.toMatch(/Domain=/i);
    expect(c.raw.some((x) => x.startsWith('__Host-assar_portal_csrf='))).toBe(true);
    expect((await c.send('get', '/v1/portal/me')).status).toBe(200);
    const token = c.jar.get('__Host-assar_portal_sid')!;
    expect(
      (
        await request(app.getHttpServer())
          .get('/v1/portal/me')
          .set('Cookie', `assar_portal_sid=${token}`)
      ).status,
    ).toBe(401);

    const out = await c.send(
      'post',
      '/v1/portal/auth/logout',
      {},
      { 'x-csrf-token': login.body.csrfToken },
    );
    expect(out.status).toBe(204);
    const setCookies = out.headers['set-cookie'] as unknown as string[];
    for (const name of ['__Host-assar_portal_sid=', '__Host-assar_portal_csrf=']) {
      const cleared = setCookies.find((x) => x.startsWith(name))!;
      expect(cleared).toMatch(/; Secure/);
      expect(cleared).toMatch(/; Path=\//);
      expect(cleared).not.toMatch(/Domain=/i);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
    }
  });
});
