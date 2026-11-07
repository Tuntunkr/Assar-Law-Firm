import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createPortalClient } from './index.js';

const me = {
  clientUser: { id: 'u', name: 'Pat', email: 'pat@x.test' },
  client: { id: 'c', name: 'Acme' },
  organization: { name: 'Firm', slug: 'firm' },
  csrfToken: 'csrf-123',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  onUnauthenticated = vi.fn(),
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createPortalClient({
    baseUrl: 'https://api.test/',
    onUnauthenticated,
    fetch: (async (url: string, init: RequestInit) => (
      calls.push({ url, init }),
      handler(url, init)
    )) as typeof fetch,
  });
  return { client, calls, onUnauthenticated };
}

describe('portal client', () => {
  it('sends credentials, and echoes the CSRF token from login on later writes', async () => {
    const { client, calls } = setup((url) =>
      url.endsWith('/login') ? json(me) : new Response(null, { status: 204 }),
    );
    await client.login({ organizationSlug: 'firm', email: 'pat@x.test', password: 'pw' });
    await client.changePassword({ currentPassword: 'a', newPassword: 'b' });
    expect(calls[0]!.url).toBe('https://api.test/v1/portal/auth/login');
    expect(calls.every((c) => c.init.credentials === 'include')).toBe(true);
    expect((calls[0]!.init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined(); // nothing to echo before login
    expect((calls[1]!.init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-123');
  });

  it('refreshes the CSRF token from me() and forgets it on logout', async () => {
    const { client, calls } = setup((url, init) =>
      url.endsWith('/me')
        ? json(me)
        : init.method === 'POST'
          ? new Response(null, { status: 204 })
          : json({ data: [] }),
    );
    await client.me();
    await client.logout();
    await client.changePassword({ currentPassword: 'a', newPassword: 'b' }).catch(() => undefined);
    expect((calls[1]!.init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-123');
    expect((calls[2]!.init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('turns the API error envelope into a typed error', async () => {
    const { client } = setup(() =>
      json(
        {
          error: {
            code: 'ACCOUNT_LOCKED',
            message: 'Too many failed attempts.',
            requestId: 'req-1',
          },
        },
        429,
      ),
    );
    const err = await client
      .login({ organizationSlug: 'f', email: 'a@b.test', password: 'x' })
      .catch((e) => e as ApiClientError);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({
      status: 429,
      code: 'ACCOUNT_LOCKED',
      message: 'Too many failed attempts.',
      requestId: 'req-1',
    });
  });

  it('reports an expired session to the app once for authenticated calls, but not for login', async () => {
    const unauth = json(
      { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: 'r' } },
      401,
    );
    const a = setup(() => unauth.clone());
    await a.client.listMatters().catch(() => undefined);
    expect(a.onUnauthenticated).toHaveBeenCalledTimes(1);
    const b = setup(() => unauth.clone());
    await b.client
      .login({ organizationSlug: 'f', email: 'a@b.test', password: 'x' })
      .catch(() => undefined);
    expect(b.onUnauthenticated).not.toHaveBeenCalled(); // a wrong password is not an expired session
  });

  it('handles network failures and non-JSON error pages without leaking details', async () => {
    const down = setup(() => {
      throw new TypeError('fetch failed');
    });
    await expect(down.client.listMatters()).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    const html = setup(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = await html.client.listMatters().catch((e) => e as ApiClientError);
    expect(err).toMatchObject({
      status: 502,
      code: 'UNKNOWN',
      message: 'Something went wrong. Please try again.',
    });
  });

  it('targets the portal endpoints', async () => {
    const { client, calls } = setup(() => json({ data: [] }));
    await client.listMatters();
    await client.listDocuments('m1');
    await client.listInvoices('m1');
    await client.listMessages('m1');
    await client.listAiOutputs('m1');
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/v1/portal/matters',
      '/v1/portal/matters/m1/documents',
      '/v1/portal/matters/m1/invoices',
      '/v1/portal/matters/m1/messages',
      '/v1/portal/matters/m1/ai-outputs',
    ]);
  });
});
