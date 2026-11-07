# API: Authentication & Organizations (v1)

Base path `/v1`. Health: `GET /healthz` (liveness), `GET /readyz` (MongoDB reachable).

## Conventions

- **Errors:** `{ "error": { "code", "message", "requestId", "details?" } }`. Codes: `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, IDEMPOTENCY_MISMATCH, MFA_REQUIRED, MFA_ENROLLMENT_REQUIRED, ACCOUNT_LOCKED, INTERNAL`.
- **Pagination:** `?limit=1..100&cursor=<opaque>` → `{ data, page: { nextCursor, limit } }`.
- **Sessions:** opaque token in `assar_sid` (HttpOnly, SameSite=Lax, Secure in production). When cookies are Secure (`COOKIE_SECURE`) the name gets a `__Host-` prefix (`__Host-assar_sid`), so browsers only accept it if it is Secure, `Path=/` and has no `Domain`; this stops a sibling subdomain planting or overwriting a session cookie. The unprefixed name is ignored in that mode. Sign-out clears the cookies with the same Secure/Path attributes, which browsers require for `__Host-` cookies. Only a SHA-256 hash is stored. Idle timeout `SESSION_IDLE_MINUTES`, absolute `SESSION_ABSOLUTE_HOURS`.
- **CSRF:** every non-GET authenticated request must send `X-CSRF-Token` (value from login response / `assar_csrf` cookie, `__Host-assar_csrf` when Secure). A browser `Origin` header must be in `CORS_ORIGINS`.
- **Idempotency:** routes marked below require `Idempotency-Key` (8-128 chars). Replays return the stored response with `Idempotent-Replayed: true`; secrets (e.g. invitation `token`) are not stored, so a replay omits them.
- **Rate limits:** auth endpoints `AUTH_RATE_LIMIT_PER_MIN` per IP; global `GLOBAL_RATE_LIMIT_PER_MIN`. Counters are in-memory (per instance).

## Auth

| Method & path                                           | Notes                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`                                   | Creates organization + owner. Disabled unless `REGISTRATION_ENABLED=true`.                                                   |
| `POST /auth/login`                                      | `{email,password,mfaCode?}`. `401 MFA_REQUIRED` if MFA enabled and no code. 5 failures → 15 min lock (`429 ACCOUNT_LOCKED`). |
| `POST /auth/logout`                                     | Revokes the session server-side.                                                                                             |
| `GET /auth/me`                                          | User, organization, role, permissions, MFA state, CSRF token.                                                                |
| `POST /auth/change-password`                            | Revokes other sessions.                                                                                                      |
| `POST /auth/accept-invitation`                          | `{token,name,password}`; single use.                                                                                         |
| `POST /auth/mfa/setup` · `/mfa/enable` · `/mfa/disable` | TOTP. Enable returns 8 single-use recovery codes (shown once). Owner/admin/billing cannot disable.                           |

Roles that require MFA (`owner`, `admin`, `billing`) receive `403 MFA_ENROLLMENT_REQUIRED` on every route except `/auth/me`, `/auth/logout`, `/auth/mfa/setup`, `/auth/mfa/enable` until enrolled.

## Organization (permission in brackets)

| Method & path                                                           |                                                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /organization`                                                     | any member                                                                                                       |
| `PATCH /organization`                                                   | `org:manage`                                                                                                     |
| `GET /organization/members`                                             | `user:manage`                                                                                                    |
| `PATCH /organization/members/:userId`                                   | `user:manage`; role/status. Cannot edit self or owner; only owner manages admins. Revokes the member's sessions. |
| `POST /organization/invitations`                                        | `user:manage`, **Idempotency-Key required**. Returns raw `token` once (no email delivery yet).                   |
| `GET /organization/invitations`, `DELETE /organization/invitations/:id` | `user:manage`                                                                                                    |
| `GET /audit-logs?action=`                                               | `audit:read`. Append-only.                                                                                       |

## Known limitations

- A user belongs to one organization (email is globally unique). Multi-org membership is a schema-compatible later change.
- Invitation emails are not sent yet (Phase 7 notifications); the token is returned to the inviter.
- Rate-limit and lockout counters: lockout is per account in MongoDB; request throttling is per instance.
- Not yet implemented: password reset, session list/revoke UI, email verification.
