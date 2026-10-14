# API: Clients, Matters, Parties, Teams, Conflict Checks (v1)

Conventions (errors, pagination, CSRF, idempotency) are in `auth-and-organizations.md`.
Every query is scoped by `organizationId` taken from the session; ids from other organizations return **404**.

## Permissions

| Permission                                    | owner | admin | attorney | paralegal | billing | staff |
| --------------------------------------------- | ----- | ----- | -------- | --------- | ------- | ----- |
| `client:read`                                 | ✓     | ✓     | ✓        | ✓         | ✓       | ✓     |
| `client:write`                                | ✓     | ✓     | ✓        | ✓         |         |       |
| `matter:read`                                 | ✓     | ✓     | ✓        | ✓         | ✓       | ✓     |
| `matter:write`                                | ✓     | ✓     | ✓        | ✓         |         |       |
| `conflict:check`                              | ✓     | ✓     | ✓        | ✓         |         |       |
| `user:manage` (teams, matter-access override) | ✓     | ✓     |          |           |         |       |

## Clients (`/clients`)

`POST` (client:write, optional `Idempotency-Key`) · `GET ?q=&status=&limit=&cursor=` (q = name prefix, accent/case-insensitive) · `GET /:id` · `PATCH /:id` (set `status: "archived"` to archive).
Audit entries record changed field _names_, never values.

## Matters (`/matters`)

- `POST` (matter:write, optional `Idempotency-Key`): `{clientId, title, practiceArea, description?, leadAttorneyId?, teamIds?, restricted?, accessUserIds?}`. The matter number (`M-<year>-<5 digits>`) comes from a per-organization counter inside the same transaction as the matter and its access rows.
- `GET ?status=&clientId=&q=` (q = title prefix or exact matter number) · `GET /:id` (includes `canManageAccess`) · `PATCH /:id` (closing/archiving sets `closedAt`, reopening clears it).
- Parties: `GET|POST /:id/parties`, `PATCH|DELETE /:id/parties/:partyId`.

### Matter-level access (restricted matters)

- A **restricted** matter is visible only to users on its access list (`GET|PUT /matters/:id/access`).
- A caller who can't see a matter gets **404**, identical to a missing one. This applies to the matter, its parties, its access list and list/search results.
- **Admins have no implicit access.** The organization **owner** has audited break-glass access (`matter.restricted_accessed_by_owner`), so a firm can't lock itself out.
- Who may change access: roles with `user:manage` or the matter's lead attorney — and only if they can already see the matter. The acting user and lead attorney are kept on the list automatically.
- Access lists accept only active members of the same organization.
- Team membership does **not** grant access to restricted matters.

## Teams (`/teams`)

`POST|PATCH|DELETE` and `PUT /:id/members` need `user:manage`; `GET` needs `matter:read`. Names are unique per organization (case-insensitive). Deleting a team removes it from matters' `teamIds`.

## Conflict checks (`POST /conflict-checks`)

Body `{names: string[1..20]}`. Compares each name with clients and matter parties in the organization.

- `exact`: same words in any order after normalizing case, punctuation, Latin accents and corporate suffixes (LLC, Inc, Ltd, …).
- `similar`: ≥ 2 shared words and one name's words are contained in the other's, or ≥ 2/3 overlap. Single-word names match only exactly.
- Matches inside restricted matters the caller can't access are returned as `{matchType, source:"party", restricted:true}` with no names or matter details.
- Every check is stored (`conflict_checks`) and audited (counts only, no names in the audit log).
- Automated name matching can miss variants (nicknames, transliterations, typos). The response says so; it doesn't replace attorney review.
