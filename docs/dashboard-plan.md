# Staff dashboard plan (`apps/dashboard`)

Status: built and verified against the live API (login with MFA, overview, matters, time, invoice create/issue). Added since: sign-up, accept-invitation, profile (details, security, sessions), firm-wide Documents with upload. Remaining modules: see `docs/modules-plan.md`. Port 3001 (the marketing site's "Open dashboard" button already points there).

## Stack

Same as `apps/client-portal`: Vite + React 19 + React Router 7 + Tailwind 4, `@assar/ui` for primitives,
`@assar/api-client` for HTTP, Vitest + Testing Library for tests. No new frameworks.

## Principles

- **The API is the policy.** The UI hides what a role cannot do (`permissions` from `/auth/me`), but never
  relies on that; every error from the API is shown with its request id.
- **Session in an httpOnly cookie**, CSRF token echoed in `X-CSRF-Token`; both handled in the api-client.
- **AI output is always labelled a draft** until a human approves it; unverified items must be acknowledged.
- **Money is integer cents** end to end; formatting only at the edge.
- Accessible by default: skip link, focus moves to content on navigation, labelled fields, live-region toasts.

## Design

Navy/blue palette from `@assar/ui/theme.css`. Dark navy sidebar (collapses to a drawer on mobile), light content
area, white cards with soft borders, compact tables, status pills, one primary action per page.

## Information architecture

| Route                        | Page                                                                                      | Needs permission |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| `/login`                     | Sign in (+ MFA code step)                                                                 | public           |
| `/mfa-setup`                 | Forced MFA enrollment for owner/admin/billing                                             | session          |
| `/`                          | Overview: stats, my tasks, upcoming events, AI waiting for review                         | any              |
| `/clients`, `/clients/:id`   | Client list, create, detail (matters, portal access)                                      | `client:read`    |
| `/matters`, `/matters/:id`   | Matter list, create, detail tabs: Overview, Documents, Parties, Tasks, AI, Portal, Access | `matter:read`    |
| `/tasks`                     | Task board/list, create, status change                                                    | `task:write`     |
| `/calendar`                  | Month/agenda view, create event                                                           | `calendar:write` |
| `/ai`                        | Jobs + outputs review queue (approve/reject/edit)                                         | `ai:use`         |
| `/time`                      | Time entries, quick add                                                                   | `time:write`     |
| `/invoices`, `/invoices/:id` | Invoices, create from unbilled time, issue, pay, void                                     | `billing:read`   |
| `/reports`                   | Billing summary, aging, time report + CSV export                                          | `billing:read`   |
| `/team`                      | Members, invitations, teams                                                               | `user:manage`    |
| `/settings`                  | Organization, billing settings, MFA, service tokens, password                             | varies           |
| `/audit`                     | Audit log                                                                                 | `audit:read`     |
| `/conflicts`                 | Conflict check                                                                            | `conflict:check` |

Notifications bell in the top bar (`/notifications`, mark read).

## Build order

1. `packages/api-client`: generic staff client (`createStaffClient`) + DTO types.
2. `packages/ui`: Modal, Table, Tabs, StatusPill, Stat, PageHeader.
3. Dashboard shell: auth, layout, routing, toasts, async view.
4. Pages in the order: Overview → Clients → Matters → Tasks → Calendar → Time → Invoices → Reports → AI →
   Team → Settings → Audit → Conflicts.
5. Tests for auth, permission gating, one CRUD flow, and money formatting; then lint/typecheck/build.

## Out of scope for this pass

- Drag-and-drop calendar, rich text editing of AI output (plain text edit only).
- Dark mode, i18n.
