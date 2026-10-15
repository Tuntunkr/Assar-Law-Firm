# Client portal (v1)

A separate web app (`apps/client-portal`) and a separate principal. Clients see **only** what the firm has explicitly published, for **their own client record**.

## Principal & sessions

- Portal users (`client_users`) belong to exactly one organization and one client. They sign in with `{organizationSlug, email, password}` (the same email can exist at several firms). Accounts are created from a single-use, 7-day invitation issued by staff.
- Session cookie `assar_portal_sid` (HttpOnly, SameSite=Lax, Secure in production) + CSRF cookie `assar_portal_csrf`; same idle/absolute timeouts as staff. Staff cookies (`assar_sid`) are different and are never accepted on portal routes, and portal cookies are never accepted on staff routes (tested, including with the raw token moved between cookie names).
- Failed sign-ins return one generic error; 5 failures lock the account for 15 minutes; sign-in is rate limited. MFA is not offered to clients yet.
- Disabling a portal user, or archiving their client, ends their sessions immediately.

## What a client can see (all opt-in)

| Item                                                                                                                                                                                                                                      | Visible when                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matter                                                                                                                                                                                                                                    | belongs to the client's record **and** a staff member published it (`PUT /matters/:id/portal`). Only `title`, `matterNumber`, `practiceArea`, `status`, dates and the client-facing `note` are returned.                                                                                                                                        |
| Document                                                                                                                                                                                                                                  | the **version** was shared (`PUT /documents/:id/versions/:n/share`), passed the virus scan, the document isn't deleted, and its matter is published. Downloads use a 5-minute signed link and are audited.                                                                                                                                      |
| AI output                                                                                                                                                                                                                                 | reviewer **approved** it (`/ai/outputs/:id/approve`) **and** someone then shared it (`PUT /ai/outputs/:id/share`). Clients get the title, body (the reviewer's edit if there is one), only the points the system verified, and a label saying it was reviewed by the legal team. Sources, model, verification details and notes are never sent. |
| Everything else (descriptions, parties, tasks, calendar, team, access lists, drafts, rejected outputs, other clients' data) is unreachable. Anything a client can't see returns the same `404 Not found` as something that doesn't exist. |

## Staff controls (need `portal:manage`: owner, admin, attorney)

`POST /clients/:id/portal-invitations` (returns the token once; no e-mail is sent yet) · `GET /clients/:id/portal-access` · `DELETE /clients/:id/portal-invitations/:invId` · `PATCH /clients/:id/portal-users/:userId {status}` · `PUT /matters/:id/portal {visible, note?}` · `PUT /documents/:id/versions/:n/share {shared}` · `PUT /ai/outputs/:id/share {shared}`.
Publishing needs access to the matter (restricted matters stay invisible to staff without access). Only scanned (`clean`) versions can be shared, and only approved outputs. Unpublishing/unsharing takes effect immediately.

## Portal API (`/v1/portal`)

`POST auth/login`, `POST auth/accept-invitation` (public) · `POST auth/logout`, `POST auth/change-password`, `GET me` · `GET matters`, `GET matters/:id`, `GET matters/:id/documents`, `POST documents/:id/versions/:n/download-link`, `GET matters/:id/ai-outputs`, `GET ai-outputs/:id`. All reads are bound to the signed-in client.

## Audit

Client actions are recorded with `actorType: "client"` (`portal.login`, `portal.document_downloaded`, …); staff publishing/sharing actions are `matter.published_to_portal`, `document.shared_with_client`, `ai.output_shared_with_client`, etc.

## Not included yet

Messaging, invoices, calendar/deadlines for clients, e-mail delivery of invitations, client MFA, password reset by e-mail.

## Frontend

React + React Router + Tailwind (`@assar/ui`), typed with `@assar/api-client`. Sign-in/invitation/matters/matter/account pages with skeleton, empty, error-with-retry, expired-session and accessible-notification states. Serve it with `Content-Security-Policy: default-src 'self'; connect-src 'self' <API origin>; frame-ancestors 'none'` and keep it on the same site as the API so the SameSite=Lax cookies are sent.
