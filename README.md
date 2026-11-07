# Assar Law Firm

Legal practice management platform for Assar Law Firm: client and matter workflow, document intelligence, AI-assisted drafting (human-in-the-loop), billing, client portal, and n8n automation—delivered as a TypeScript monorepo.

## Stack

| Layer | Technology |
| ----- | ------------ |
| API | NestJS, MongoDB, session auth + MFA |
| Workers | BullMQ / Redis (extract, OCR, AI jobs) |
| Web | Next.js (marketing) |
| Staff apps | Vite + React (dashboard, client portal) |
| Tooling | pnpm, Turborepo, Vitest |

## Repository layout

```
apps/api              REST API and auth
apps/worker           Background job processors
apps/web              Public marketing site
apps/dashboard        Staff dashboard SPA
apps/client-portal    Client-facing portal
packages/database     Mongoose models and repositories
packages/types        Shared domain types
packages/validation   Zod schemas
packages/jobs         Queue definitions and processors
packages/ui           Shared React components
docs/                 Architecture, API notes, runbooks
```

## Prerequisites

- Node.js **22+**
- [pnpm](https://pnpm.io/) **9.x**
- MongoDB, Redis, and S3-compatible storage (see `.env.example` in each app)

## Quick start

```bash
pnpm install
cp apps/api/.env.example apps/api/.env    # fill in values
cp apps/worker/.env.example apps/worker/.env
pnpm dev
```

| App | Default URL |
| --- | ----------- |
| Web | http://localhost:3000 |
| Dashboard | http://localhost:3001 |
| Client portal | http://localhost:3002 |
| API | http://localhost:4000 |

## Scripts

```bash
pnpm build        # build all packages and apps
pnpm dev          # run apps in parallel
pnpm test         # unit and integration tests
pnpm lint         # ESLint across the workspace
pnpm typecheck    # TypeScript project references
```

## Documentation

- [Architecture](docs/architecture.md) — modules, data model, frontends
- [Auth & organizations](docs/api/auth-and-organizations.md)
- [Client portal](docs/api/client-portal.md)
- [Worker runbook](docs/runbooks/worker.md)

## Security

Do not commit `.env` files or credentials. Run `node scripts/check-secrets.mjs` before pushing if you add new config.

## License

Proprietary — Assar Law Firm. All rights reserved.
