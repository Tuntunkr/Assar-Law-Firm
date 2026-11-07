/**
 * Cookie names. When cookies are Secure (production) they get the `__Host-` prefix: browsers then refuse the
 * cookie unless it is Secure, has `Path=/` and no `Domain`, which stops a sibling subdomain from planting or
 * overwriting a session cookie ("cookie tossing").
 */
/**
 * Attributes shared by setting and clearing a cookie. They must match: a `__Host-` cookie can only be
 * overwritten or deleted by a Set-Cookie that is itself Secure with Path=/, otherwise the browser ignores it.
 */
export function cookieBase(secure: boolean) {
  return { secure, sameSite: 'lax' as const, path: '/' };
}

export function cookieNames(secure: boolean) {
  const p = secure ? '__Host-' : '';
  return {
    session: `${p}assar_sid`,
    csrf: `${p}assar_csrf`,
    portalSession: `${p}assar_portal_sid`,
    portalCsrf: `${p}assar_portal_csrf`,
  } as const;
}
