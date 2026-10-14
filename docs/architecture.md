# Assar Law Firm — Architecture Plan

Status: proposed (Phase 0). Update as phases land.

## 1. Principles

- Modular monolith first (NestJS); modules communicate via services, never via each other's collections.
- Every query is organization-scoped; matter-level restrictions are enforced in a single access-policy layer.
- AI output is always a _draft_ until a human approves. No fabricated citations, facts, or deadlines.
- Secrets (Grok key, DB, storage) exist only in `apps/api` and `apps/worker` environments.
- n8n never holds user credentials; it calls the API with a scoped service token and per-organization permission checks.

## 2. Workspace layout and dependency graph

```
packages/config      (tsconfig, eslint, prettier, tailwind preset)   <- everything
packages/types       (domain types, enums, error envelope)           <- no deps
packages/validation  (zod schemas)                                    <- types
packages/database    (mongoose models, indexes, repositories)         <- types
packages/api-client  (typed fetch client)                             <- types, validation
packages/ui          (React + Tailwind components)                    <- config

apps/web             -> ui, types, validation, api-client
apps/dashboard       -> ui, types, validation, api-client
apps/client-portal   -> ui, types, validation, api-client
apps/api             -> database, types, validation
apps/worker          -> database, types, validation
```

Rules: apps never import other apps; frontends never import `database`; `types` has no runtime deps.

## 3. Frontends

| App           | Framework            | Port | Notes                                                                        |
| ------------- | -------------------- | ---- | ---------------------------------------------------------------------------- |
| web           | Next.js (App Router) | 3000 | SSG/ISR marketing; content in `content/*.ts`, pricing in `config/pricing.ts` |
| dashboard     | Vite + React Router  | 3001 | authenticated SPA, cookie sessions                                           |
| client-portal | Vite + React Router  | 3002 | client-scoped, approved documents only                                       |

### Web routes

`/`, `/services`, `/law-firm-management`, `/ai-legal-copilot`, `/document-intelligence`, `/workflow-automation`, `/solutions` (+ `/solutions/[practice]`), `/pricing`, `/about`, `/contact` (demo booking), `/faq`, `/privacy`, `/terms`, `/login` (links to dashboard / client portal), `/sitemap.xml`, `/robots.txt`.

### Dashboard routes

`/login`, `/mfa`, `/` (overview), `/clients`, `/clients/:id`, `/conflicts`, `/matters`, `/matters/:id` (tabs: overview, parties, documents, tasks, timeline, AI, billing), `/calendar`, `/tasks`, `/documents`, `/ai/reviews` (approval queue), `/communications`, `/billing`, `/invoices`, `/reports`, `/settings/{organization,team,roles,security,integrations}`, `/audit-log`.

### Client portal routes

`/login`, `/` (my matters), `/matters/:id`, `/documents`, `/messages`, `/invoices`.

## 4. Backend modules (apps/api)

`auth`, `organizations`, `users/teams/roles`, `clients` (+conflicts), `matters`, `documents` (+storage), `calendar/tasks`, `ai`, `workflows` (n8n bridge), `notifications`, `billing`, `audit`, `health`.
Cross-cutting: config validation (zod), request-id + structured logging (pino, redaction), global exception filter producing the error envelope, rate limiting, idempotency interceptor, access-policy guard.

### Error envelope

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [], "requestId": "…" } }
```

### Pagination

Cursor-based: `?limit=25&cursor=<opaque>` → `{ data: [], page: { nextCursor, limit } }`.

## 5. Data (MongoDB collections)

All tenant collections carry `organizationId` and lead every compound index with it.

| Collection                  | Key indexes                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| organizations               | `slug` unique                                                         |
| users                       | `email` unique; `organizationId`                                      |
| memberships                 | `{organizationId,userId}` unique                                      |
| teams                       | `{organizationId,name}`                                               |
| roles                       | `{organizationId,key}` unique                                         |
| clients                     | `{organizationId,normalizedName}`, text on names                      |
| parties                     | `{organizationId,normalizedName}` (conflict checks)                   |
| matters                     | `{organizationId,status,updatedAt}`, `{organizationId,clientId}`      |
| matter_access               | `{organizationId,matterId,userId}` unique (restricted matters)        |
| documents                   | `{organizationId,matterId,createdAt}`                                 |
| document_versions           | `{documentId,version}` unique; storage key only, never bytes          |
| events (hearings/deadlines) | `{organizationId,startsAt}`, `{organizationId,matterId}`              |
| tasks                       | `{organizationId,assigneeId,status,dueAt}`                            |
| ai_jobs                     | `{organizationId,status,createdAt}`, `idempotencyKey` unique per org  |
| ai_outputs                  | `{organizationId,matterId}`; `reviewStatus` draft/approved/rejected   |
| communications              | `{organizationId,matterId,createdAt}`                                 |
| notifications               | `{userId,readAt,createdAt}`                                           |
| invoices / time_entries     | `{organizationId,clientId,status}`                                    |
| audit_logs                  | `{organizationId,createdAt}`, append-only; TTL not applied by default |
| idempotency_keys            | `{organizationId,key}` unique, TTL 24h                                |
| sessions                    | `tokenHash` unique, TTL on expiry                                     |

Transactions (replica set required): matter creation with access rows, invoice finalization, document version commit.

## 6. Authentication model

- Argon2id password hashing; httpOnly + Secure + SameSite=Lax session cookie (opaque token, hash stored server-side), CSRF double-submit token for state-changing calls.
- TOTP MFA; mandatory for roles `owner`, `admin`, `billing`.
- Client portal uses a separate principal type (`clientUser`) with its own session audience.
- RBAC: permission strings (`matter:read`, `document:write`, …) mapped from roles; matter-level access (`restricted: true`) checked additionally.
- n8n uses a service token with limited scopes + an organization header; the API re-checks permissions.

## 7. Documents

Private S3-compatible bucket (MinIO in dev). Uploads go to quarantine key, scanned (ClamAV) by worker, then promoted. Downloads via pre-signed URL (≤ 5 min) issued after a permission check and audit entry.

## 8. AI and jobs

- Queue: BullMQ on Redis (durable, retries, backoff, dead-letter via failed set).
- Flow: API creates `ai_jobs` row (status `queued`) → enqueues → worker sets `processing` → calls `GrokService` → stores `ai_outputs` (`reviewStatus: draft`) → status `succeeded`/`failed`. UI shows only real statuses.
- Prompts include only authorized source excerpts; outputs carry source references (document id, version, page/offset). Prompt/response bodies are not logged.
- Worker exposes `/healthz` and queue depth metrics.

## 9. Workflow automation

`services/workflows/*.json` are exported n8n workflows (reminders, onboarding, task assignment, doc-processing triggers, daily report). Imported by script; credentials referenced by name, never committed.

## 10. Deployment

Docker Compose for dev (mongo replica set, redis, minio, clamav, n8n, mailpit) and a production compose + Caddy reverse proxy. Rollback = redeploy previous image tag; DB migrations are forward-compatible (expand/contract). Details in `docs/runbooks/`.

## 11. Phases and exit criteria

Each phase ends with: lint, typecheck, tests, and production build run and results reported. Phases follow the order in the brief (1 foundation → 9 pilot readiness).

## 12. Known constraints in the current environment

- Docker is not installed on this machine, so container configs are written but unverified until run elsewhere.
- Legal/compliance claims are not made on the marketing site; pricing numbers are placeholders marked for business approval.
