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
- MongoDB as a replica set, and Redis. `scripts/dev-services.sh` uses `127.0.0.1:27117` and `127.0.0.1:6380` only for directories it owns. `scripts/local-demo.sh` leaves a foreign server running and records the ports it actually opened in `.data/demo-services.env`. S3 is for production storage. Local demo files stay on disk.

## Quick start

Configuration is the root `.env.example`. The API and the worker load that root file. There is no `apps/api/.env.example`.

```bash
pnpm install
bash scripts/dev-services.sh start
cp .env.example .env
pnpm dev
```

A synthetic firm on this computer, with registration turned off after seeding:

```bash
bash scripts/local-demo.sh start
bash scripts/local-demo.sh status
bash scripts/local-demo.sh stop
```

Login material is written only to `.data/demo-login.txt`. See [docs/localhost.md](docs/localhost.md). That path is this computer, not a production host.

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
- [Local synthetic demo](docs/localhost.md)
- [Master PRD](docs/prd/assar-law-firm-master-prd.md)

## Security

Do not commit `.env` files or credentials. Run `node scripts/check-secrets.mjs` before pushing if you add new config.

## License

Proprietary — Assar Law Firm. All rights reserved.
