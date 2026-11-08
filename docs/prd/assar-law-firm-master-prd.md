# Assar Law Firm — master product requirements

| Field | Value |
| --- | --- |
| Document id | ASSAR-PRD-2026-11-08 |
| Version | 1.0.3 |
| Cutoff | 8 Nov 2026, 10:23 IST. Later notes in this file are labelled with the clock time they were verified on this worker. |
| Owner | Tuntunkr |
| Repository | Tuntunkr/Assar-Law-Firm |
| Product shape | First firm is a friend firm. The data model isolates one firm from another so a second firm can be added later. This is not a public multi-tenant SaaS launch. |
| Classification | Internal requirements. No real client records and no secrets belong in this file. |
| Not a certificate | This document is not a security certificate, a penetration-test report, a legal opinion, a tax opinion, or a statement that the product is complete. |

The shorter fulfilment note for the six modules approved on 7 Nov 2026 remains [approved-practice-modules.md](approved-practice-modules.md). This master document is the source of truth for scope, status, and the next session. Where the two disagree, the status label in this document wins.

## 1. How to read a status

Every feature, route family, and acceptance row uses one of these labels. A row may carry more than one label when committed code and the uncommitted continuation differ.

| Label | Meaning |
| --- | --- |
| MAIN-SOURCE | Read from `main` at `a6314727bbffe3908a52b13457bd9e0bf39c6bd0` or from a static audit of that tree. No runtime claim is attached. |
| BRANCH-IMPLEMENTED | Present in commit `7d7efdf2d008c7e88d406cc3efbf8d5ec9ab151d` on `cursor/approved-practice-modules-d89d`. |
| WORKING-TREE | Present in the uncommitted continuation on that same branch when this document was written. It is not in `7d7efdf`. A later commit may supersede `7d7efdf`. Until that commit exists, do not treat WORKING-TREE as released. |
| LIVE-GATED | A code path exists, or is specified, and it does not become a live service until an external account, secret, HTTPS endpoint, or human approval is supplied. |
| REQUIREMENT | Owner intent. It may be only partly present in code. |
| UNKNOWN | Not verified on this worker. Do not fill the gap with a plausible value. |

Historical test numbers in section 4 are cited from the prior session’s own report. This documentation pass did not re-run that full suite.

## 2. Product intent

Assar is the operating system for one law firm’s own work: who may sign in, which matters they may see, what the firm typed about a court, which documents stay private, which dates a lawyer approved, which client messages were only previewed, and which invoices a person issued and marked paid by hand.

The first deployment is that friend firm, on infrastructure the firm controls. Firm isolation is a foundation, not a marketplace. Open self-service signup of arbitrary firms is a switch (`REGISTRATION_ENABLED`), and the production check warns when it is left on. The default in `loadEnv` is off.

### 2.1 Decisions that stay closed

- No universal court API, no scraping, and no captcha bypass.
- No statutory limitation calculator and no automatic legal advice.
- No claim that a WhatsApp template, a court form, or a tax rate is approved.
- No payment gateway in this phase. The owner adds their own gateway API and security after a full local demo. No gateway client, webhook, or `PAYMENT_GATEWAY` variable exists in the tree. Manual payment recording stays.
- No production database, production deploy, merge, real recipient message, charge, or court filing without a separate approval.
- Only WIMO development is paused. Existing WIMO marketing routines stay as they are and are not paused. This repository does not change those routines or any other repository. That boundary was already the owner’s rule. It is not a new instruction to edit WIMO.
- A GitHub pull request was refused because the account must be a collaborator. That refusal stands. This document does not authorise a workaround.

### 2.2 Unknowns that block product claims

The firm’s legal name for publication, office address, practice areas, fee policy, retention period, tax registration, and which roles the friend firm will actually staff are UNKNOWN. The marketing site must not invent them. Currency can be INR; the default organization billing currency in code is USD until a person changes it. GST treatment is conditional on an accountant. The software does not choose a rate.

A client meeting was expected on 8 Nov 2026. The time was not stated. This document does not invent one.

## 3. Decision history

This is the decision trail. It is not a transcript and it does not repeat private call content.

| When | What was decided |
| --- | --- |
| 7 Nov 2026, call `cu155383017`, primary bot `0b981981-9453-4fd8-8506-d5e02b4dd5b3` | Competitor research meant legal practice software, Indian and international, not computer hardware. The useful output is the top few features and the public pricing posture of each product, plus what that implies for Assar. |
| Same call, later | The work to be audited was workflow, requirements, architecture, database, UI, features, API, and automation. |
| Same night | The implementation inventory was: finish the pending practice modules, connect them, test them, fix them, and land a truthful marketing page. Twelve motion patterns and design assets were named. The owner’s Hindi confirmation was that the work should be complete by morning. The assistant continued with explicit caveats for courts and WhatsApp. A native user timestamp of 23:50 IST was a delegation clock, not a second user message. |
| 7 Nov 2026 | No instruction was found that said a screenshot by itself proves image or motion work. |
| 8 Nov 2026, about 10:18 IST | Continue on the same branch from `7d7efdf`. Implement remaining group-3 behaviour that can be real without faking a live provider, and make a reproducible localhost stack with Mongo, auth, roles, schema, and security checks. |
| 8 Nov 2026, about 10:21 IST | Do not build or activate a payment gateway. Keep manual payments. Document the gateway as deferred to the owner’s own API. Prioritise a synthetic localhost demo over providers that are not available. The master PRD is the documentation task. |
| 8 Nov 2026, about 10:22 IST | Feature completion and local checks come first. Owner UAT, then a client presentation discussion, come later. |
| 8 Nov 2026, this write | The earlier attempt to land this file was classified as an error twice, not as a refusal. This worker writes the file through the normal docs path. |

## 4. Evidence register

| Item | State on this worker |
| --- | --- |
| `main` baseline | `a6314727bbffe3908a52b13457bd9e0bf39c6bd0`. Static audit only. |
| Branch HEAD when this file was authored | `7d7efdf2d008c7e88d406cc3efbf8d5ec9ab151d`. Subject: “Patch Next.js to 16.4.5 and raise essential tap targets to 44px.” |
| Shared clone `/workspace/projects/Assar-Law-Firm` | Not present here. Do not treat it as updated. |
| Legal pack `/workspace/assar-law-firm/legal-reference/` and the zip beside it | Not present on this worker. |
| Prior execution report | `/opt/cursor/artifacts/assar-practice-modules-review-7d7efdf.md` is present. The read-only audit file `assar-law-firm-readonly-audit-a631472.md` is also present and was not regenerated. |
| Landing and dashboard PNGs named in the prior report | Present under `/opt/cursor/artifacts/` (`landing-before-1440.png`, `landing-before-390.png`, `landing-after-1440.png`, `landing-after-390.png`, `landing-after-menu-390.png`, `dashboard-dates-current-1440.png`, `dashboard-updates-current-1440.png`). This documentation pass did not re-measure them. Screenshots are not motion proof. |
| Historical commands, 8 Nov 2026 00:56:37 IST, cited from the prior session | `pnpm typecheck` 20/20, `pnpm lint` 20/20, `pnpm build` 13/13, exit 0. Turbo cache: 19 of 20 typecheck/lint tasks were not fresh. |
| Historical API tests | 31 files, 293 passed, 6 skipped because `N8N_BIN` was unset. A separate run with `N8N_BIN` set to a disposable n8n 1.123.92 passed those 6. n8n is not a project dependency. |
| Historical other package tests | Worker 10, dashboard 38, portal 26, jobs 49, workflows 33, storage 3, api-client 6, database 11, types 18, validation 6. Web `vitest run --passWithNoTests` exits 0 with no test files. UI script prints that it has no tests. Neither is coverage. |
| OCR | The jobs fixture failed on the host sans-serif face reading “is” as “1s”. The fixture now registers Liberation Sans Bold or DejaVu Sans Bold. The assertion remains the words `rent is 5000` and a prepared width greater than 700. That is a font fix, not an accuracy certificate. |
| Disposable services used by those tests | MongoDB on `127.0.0.1:27117` replica set `rs0`, Redis on `127.0.0.1:6380`. WhatsApp tests use a fake fetch. |
| Browser evidence | Selected 1440 and 390 captures of the landing page and two dashboard screens. Not a full signed-in journey of every route. |
| Remote CI | `main` had a failing check at 7 Nov 2026 23:35:54 IST, separate from this branch. Branch remote CI success is UNKNOWN. |
| Pull request | Not opened. GitHub refused with the requirement that the author be a collaborator. |
| WORKING-TREE activation tests, this continuation, before this docs commit | `pnpm --filter @assar/api exec vitest run test/activation.test.ts` reported 7 passed, about 3.3s. That file is uncommitted. It is not the historical 293. |
| Restart persistence of a demo document | NOT-RUN in this documentation pass. Do not claim it. |
| Owner UAT, merge, deploy | Not done. |

### 4.1 Continuation checked on this cloud worker

This is not the owner’s computer. The owner’s machine was not used.

On 8 Nov 2026, after version 1.0.1, the uncommitted continuation was booted here and checked. The implementation commit is `80c7083a8ec425c6b8fa8b064f8405a5ff7c53fd`. Commands and counts are in the handoff artifact, not repeated as a certificate.

- API tests, fresh vitest, not a Turbo cache: 300 passed, 6 skipped because `N8N_BIN` was unset. A separate run with the disposable n8n 1.123.92 passed those 6.
- Worker tests: 10 passed. Other package tests passed, including dashboard 38, portal 26, jobs 49, workflows 33. `@assar/web` still has no test files. `@assar/ui` still prints that it has no tests. Storage’s 3 tests were a Turbo cache hit.
- `GET /v1/auth/register` returned 403, “Registration is disabled.”
- Owner login succeeded. The intern, who had no assignment, received 404 for the synthetic matter. An unknown matter id returned 404. `GET /v1/courts/provider` stayed `external_activation_gate`.
- An executable upload returned 400. A filename with `../` was stored as a sanitised name. The bytes landed under `.data/storage` at the `org/.../matter/.../doc/...` key. The version status became `skipped`, not `clean`, because this demo sets `SCAN_PROVIDER=disabled`. A download before that status was 409.
- Passwords in `users` start with `$argon2id`. Owner and billing have MFA enabled. The MFA field is not the short authenticator secret.
- Indexes read from the live `assar_demo` database match the schema names in section 8, including `matteraccesses` and `organizationId_1_court.cnr_1`.
- Stopping the mongod that actually held the data made `GET /readyz` return 503 `{"status":"not_ready","checks":{"mongodb":"failing","redis":"ok"}}` after a small health-controller fix. Starting that same data directory again returned the matter `Synthetic preview matter`, CNR `SYNTHETICPREVIEW`, and the 23-byte file row. The first restart attempt was wrong: `scripts/dev-services.sh` did not own the already-running mongod, its data directory was `/tmp/mongo-data`, and `mongod` was not on this shell’s PATH. `./.data/mongo` is a different directory and did not contain `assar_demo`.
- Browser, headless Chrome, console empty: home, services, solutions, pricing, and contact at 1440 and 390. No horizontal overflow. Contact offered local slots. The mobile menu opened. Focused skip link measured about 138×44. Unfocused, it is clipped. Reduced motion set the eyebrow animation name to `none`; the normal name was `rise`. A screen recording was saved and was not reviewed, because the video reviewer could not be started. Computed style is the motion evidence.
- Dashboard matters, updates, and invoices were opened as the owner. The portal at 390 showed the synthetic matter for the portal user. Staff sidebar links measured about 36px tall. That is not a 44px pass for the dashboard.
- No payment gateway, no live court, no live WhatsApp, no SMTP send, no merge, and no deploy.

### 4.2 Connected journey on the isolated demo, 8 Nov 2026

The implementation commit is `b98c20a37d24c7f47b7cefb54f980dd82089e905`. Section 4.1 used the MongoDB already listening on port 27117, data directory `/tmp/mongo-data`. That server is not this demo’s directory. This pass did not stop it, drop it, or change its configuration. `mongod` is not on this shell’s PATH. The script printed the binary it used: `/tmp/mongodb-linux-x86_64-ubuntu2204-7.0.14/bin/mongod`.

The demo that this pass owns is:

| Piece | Actual path or port |
| --- | --- |
| MongoDB | `/workspace/.data/demo-mongo` on `127.0.0.1:27119`, replica set `rs0`, no server user and no auth |
| Redis | `/workspace/.data/redis` on `127.0.0.1:6382`. The process working directory is that folder. Redis removes `--dir` from its command line, so ownership is the working directory, not the command text |
| Files | `/workspace/.data/storage` |
| Left running, not owned | MongoDB pid on `/tmp/mongo-data` port 27117, and Redis on 6380 whose working directory is `/tmp` |
| App ports | Marketing 3000, staff 3001, portal 3002, API 4000, worker health 4100 |

App passwords are argon2id (`$argon2id$` on `users.passwordHash`). That is application login. It is not MongoDB server authentication. The `admin` database on this mongod has no users.

`scripts/run-journey.mjs` drove the live API and exited 0. One matter went through intake, a human conflict check, team and opposing party, a private text upload, staff download of the same bytes, hearing outcome draft, paralegal review denied, attorney review, a typed next date, deadline draft, paralegal approval denied, attorney approval, an intern task, the intern’s own task update, the intern’s 404 on the other matter, a local email held on this computer, a mock WhatsApp-channel update with no socket, portal publish, an 18% draft blocked until the billing user recorded accountant review, issue, a manual bank transfer, and the portal user seeing only their matter, the paid invoice, and the mock update. The portal document list stayed empty. Sharing the unscanned file returned 409, “Only versions that passed the security scan can be shared.” The file status is `skipped`, not `clean`. Staff can download it. The portal cannot, until a real scanner marks it clean. This pass did not mark `skipped` as `clean`.

The same records were opened in the staff and portal screens: matter overview with CNR `SYNTHETICJOURNEY`, the documents tab, the matter tasks tab, December’s calendar row for the hearing, the dates list, client updates, the intern’s task list, the intern’s denial, the billing invoice in INR, the portal list, the portal matter, and the other client’s matter. Console error lists for those sessions were empty. Screenshots are under `/opt/cursor/artifacts/journey-*.png`.

Staff sidebar links measured 44px tall. The skip link, after the page was focused and Tab was pressed, measured about 137×44. A later Tab landed on Clients at 44px with a solid 2px outline. Portal skip and nav links were also at least 44px. At 390px the document scroll width matched the viewport on the matter, intern tasks, portal matter, and, after the table wrapper was marked `relative`, the invoice. Reduced motion set nav `transition-duration` to `0.01ms` and `animation-name` to `none`. No video is part of this evidence.

Stopping only the mongod whose `--dbpath` was `/workspace/.data/demo-mongo` made `GET /readyz` return 503 `{"status":"not_ready","checks":{"mongodb":"failing","redis":"ok"}}`. Starting that same directory on 27119 again returned the journey matter and the 23-byte file. `bash scripts/local-demo.sh stop` then `start` left the foreign MongoDB and Redis running, started the owned directories again, did not reseed, kept registration at 403 “Registration is disabled,” and the journey matter was still `portalVisible`.

Fresh production build, cache bypassed: `pnpm exec turbo run build --force --filter=@assar/api --filter=@assar/dashboard --filter=@assar/client-portal --filter=@assar/web`. Exit 0. 11 tasks, 0 cached. The dashboard build warned that one chunk is larger than 500 kB. `@assar/ui` build is a typecheck with no emit, so Turbo warned that the task has no output files. Neither warning is a failed build.

Still missing after this pass: owner-machine run, owner UAT, merge, deploy, a pull request, a restored backup, a real scanner so the portal can receive the file, a payment gateway, live court, live WhatsApp, SMTP, and production n8n. The attorney matter screen shows the lead attorney as “Unknown” because that role cannot list members. The id is stored. Repeated journey runs left extra synthetic rows in `assar_demo`. `bash scripts/local-demo.sh reset` drops only that database. It was not run after the persistence check, so the extra rows are still there.

## 5. Users and the permission map

Staff roles in `packages/types/src/index.ts` are `owner`, `admin`, `attorney`, `paralegal`, `billing`, `staff`, and `intern`. There is no staff role named `client`. A portal user is a `ClientUser` with a separate cookie.

MFA is required for `owner`, `admin`, and `billing`. Attorney, paralegal, staff, and intern are not in that list.

`form:approve` exists only in the WORKING-TREE. On `7d7efdf` the lawyer-only permissions are `hearing:review`, `deadline:approve`, and `message:approve`.

Static map from `ROLE_PERMISSIONS`. Matter restrictions are a second check. A hidden button is not the control.

| Role | Static grants (WORKING-TREE) | What this does not grant |
| --- | --- | --- |
| owner | Every permission, including `billing:write` and all lawyer-only permissions. | A bar-roll check. Owner authority is a software role. |
| admin | Every permission except `billing:write` and the lawyer-only set. | Lawyer approval of a hearing, a deadline, a message, or a court-form signoff. Admin manages membership; that is not a licence to approve law. |
| attorney | Clients, matters, conflicts, documents, tasks, calendar, AI use and approve, portal, time, and the lawyer-only set including `form:approve` in the working tree. | `billing:write`, `org:manage`, `user:manage`, `audit:read`, `workflow:manage`. |
| paralegal | Clients, matters, conflicts, documents, tasks, calendar, AI use, time. | Any lawyer-only approval, billing write, org admin. |
| billing | `client:read`, `matter:read`, `billing:read`, `billing:write`. | Documents, tasks, calendar, AI, portal admin, lawyer approval. `matter:read` is not a grant to browse every file. |
| staff | `client:read`, `matter:read`, `document:read`, `task:write`, `calendar:write`. | Writes to clients or matters, billing, AI, approvals. |
| intern | `matter:read`, `document:read`, `task:write`. | The access service is what limits this to assigned matters and own tasks. The permission list alone is not the isolation proof. No legal approval and no billing. |
| portal user | Own explicit shares: portal-visible matters, shared document versions, issued or paid invoices, released messages, shared reviewed AI text. | Drafts, other clients’ matters (the API uses 404), staff tools. |
| service token | One of `reminders:read`, `notifications:write`, `tasks:write`, `matters:read`, `reports:read`, and only on routes marked for that scope. | Staff cookie routes. A bearer token on a form-signoff route is unauthenticated. It is not a lawyer. |

Negative cases that the requirements demand, and that later tests must keep: cross-firm read and write, forged ids, unassigned intern, revoked member, expired or reused invitation, signup role injection, session after logout, MFA enrollment block for privileged roles, portal user reading another client, and a service token calling a lawyer route. Historical tests cover a large part of auth, intern 404, and cross-firm 404. This document does not mark every cell re-verified.

Organization id is taken from the session on the server. A caller-supplied firm id is not the scope.

## 6. Feature registry

Each entry has a purpose, a status, the workflow it belongs to, acceptance, and dependencies.

### 6.1 Firm, session, and invite

Purpose: one firm, invited people, a server-side role, a session cookie, CSRF on unsafe browser calls.

Status: BRANCH-IMPLEMENTED for register (flag), login, logout, invitation, argon2id password hash, MFA setup and enable, session revoke. MAIN-SOURCE had the same spine without the intern role and without the practice modules.

Workflow: W1, W9.

Acceptance: privileged roles cannot finish work until MFA is on; logout kills the session; duplicate email conflicts; a weak secret is rejected in production; registration defaults off.

Depends on: Mongo, the session secret, the MFA encryption key. Those values are local and are not written here.

### 6.2 Clients, matters, parties, teams, conflicts

Purpose: the firm’s book of work. Conflict check is a human-reviewed endpoint, not an automatic clearance.

Status: BRANCH-IMPLEMENTED. Court fields on the matter are BRANCH-IMPLEMENTED and stay manual.

Workflow: W1.

Acceptance: a person in firm A cannot read firm B’s client or matter; restricted matters hide from people without an access row; conflict result is stored as a check, not as a court finding.

Depends on: membership and matter access.

### 6.3 Court card and cause list

Purpose: a person types court name, case number, judge, courtroom, jurisdiction, filing date, a 16-character CNR, and an https URL. Freshness is `unverified` until someone with `matter:write` records that they compared it. A verification older than seven days is stale. Editing the court block clears verification.

Status: BRANCH-IMPLEMENTED for the card and for `GET /v1/courts/provider`, which returns `id: none`, `status: external_activation_gate`, `lookup: not_performed`. LIVE-GATED for any real feed. WORKING-TREE adds `COURT_FEED=manual|import` (default `manual`). Import stores rows the firm already has. It does not fetch. `appliedToMatter` is always false. Unique key is organization, source name, and external id. A changed payload without `retry` is a conflict. A `retrievedAt` older than seven days is stale.

Workflow: W1, W2.

Acceptance: bad CNR or a non-https URL is rejected. No test may claim a court was contacted.

Depends on: a human, and later an authorised provider agreement if one ever exists. There is no universal API.

### 6.4 Hearings, tasks, timeline

Purpose: a manual calendar. A hearing can hold an outcome draft. A lawyer reviews it. The next hearing is created only when a lawyer asks, at a chosen 10:00 IST instant, not a time read from a court.

Status: BRANCH-IMPLEMENTED. The outcome dialog in the dashboard still uses `window.prompt`. That is a known rough edge, not a legal feature.

Workflow: W2.

Acceptance: a non-lawyer cannot mark the outcome reviewed. No automatic publication to the client.

### 6.5 Documents, scan, OCR, templates

Purpose: private original bytes outside Mongo, a version row, a scan state, derived text, a draft template with placeholders.

Status: BRANCH-IMPLEMENTED. Scanner outage does not mark a file clean. Production rejects `SCAN_PROVIDER=disabled`. OCR fixture fix is BRANCH-IMPLEMENTED and is not an accuracy certificate. Templates are firm drafts. They are not court forms and they are not filings.

Workflow: W4.

Acceptance: executable content types are rejected; path separators in filenames are stripped; download uses a signed URL bound to the key; another firm’s key does not resolve.

Depends on: local directory or a private S3 bucket, ClamAV when scanning is on, the worker queue.

### 6.6 AI copilot

Purpose: draft summaries and extractions that stay in review until a person approves them.

Status: BRANCH-IMPLEMENTED and default off (`AI_ENABLED=false`). LIVE-GATED on a worker Grok key that the API never sees.

Workflow: W4.

Acceptance: no fabricated citation is stored as a source of law. The model is not asked to compute a limitation period. A portal user sees an output only after it is shared.

### 6.7 Deadlines

Purpose: a date a person typed, with a reason, in an Asia/Kolkata calendar day. Kind `limitation` is a label.

Status: BRANCH-IMPLEMENTED. There is no statutory engine.

Workflow: W3.

Acceptance: submit, lawyer approve or reject, history, in-app reminders. An edit returns the row to a state that needs approval again. Intern and paralegal cannot approve.

### 6.8 Messages and WhatsApp

Purpose: a preview that records opt-in and that the opt-in names the firm. A lawyer approves. The default provider is `unconfigured`, so approval stops at `external_activation_gate`.

Status: BRANCH-IMPLEMENTED for preview, opt-out, mock delivery, and the WhatsApp Cloud adapter. LIVE-GATED. WORKING-TREE adds email delivery modes: `off` (keep the message-provider path), `local` (write `localmailboxes`, status `held_local`, no socket), `smtp` (status `external_activation_gate`, provider `smtp`, error `smtp_send_not_enabled`, no connection). SMTP host variables are not read.

Workflow: W6.

Acceptance: missing consent is rejected. Free-form WhatsApp text outside the documented window is refused. Template name and language must both be present or both absent. `providerTemplateApproval` stays `not_claimed`. Webhook signatures cover the raw body. Replays do not move the status backwards.

Depends on, for a live send: the firm’s Meta app, phone number id, access token, app secret, verify token, an HTTPS webhook, a template Meta has already approved, and a recorded opt-in. Graph version in code is `v27.0` from Meta’s send-messages curl updated 4 Nov 2026. That version is a pin, not a statement of future law.

### 6.9 Time, invoices, manual payments

Purpose: time in the firm’s chosen currency, a draft invoice, issue, void, a person records a payment, aging and CSV. Reminders are in-app records, not a sent WhatsApp.

Status: BRANCH-IMPLEMENTED. Default currency USD. INR is a configured choice. Tax rate is basis points typed by a person, default 0. WORKING-TREE blocks issue when `taxRateBp > 0` and no accountant review is stored. Zero-tax issue is unchanged. Payments use an idempotency key and an aggregation `$literal` so a `$` reference cannot become an operator.

Workflow: W7.

Acceptance: a second payment with the same key does not double-charge the ledger. A taxed draft cannot be issued until a person with `billing:write` records the review. The software does not choose GST.

Depends on: the owner’s later gateway, which is not in this tree.

### 6.10 Intern

Purpose: a person who sees assigned matters and updates own tasks.

Status: BRANCH-IMPLEMENTED.

Workflow: W5.

Acceptance: another matter is 404, the same as missing. Revocation removes the access. No billing and no legal approval.

### 6.11 Client portal

Purpose: the client sees what the firm explicitly released.

Status: BRANCH-IMPLEMENTED. Invoices in the portal are issued or paid, without draft line descriptions. Messages are released statuses only. The matter must be `portalVisible`.

Workflow: W1, W6, W7.

Acceptance: another client’s matter is 404. Drafts stay hidden.

### 6.12 API, worker, Redis, storage, n8n

Purpose: the Nest API on `/v1`, a worker that scans and runs jobs, Redis queues, private object storage, and n8n workflow JSON that is off until configured.

Status: BRANCH-IMPLEMENTED. `WORKFLOWS_ENABLED` defaults false. An `example.com` webhook host is rejected. Disposable n8n tests are historical evidence, not a production connection. Docker compose under `infrastructure/docker-compose.dev.yml` was not validated on the machine that wrote it. The proven local data ports are 27117 and 6380 from `scripts/dev-services.sh`.

Workflow: W8.

### 6.13 Marketing site

Purpose: a calm public page that names the firm and does not invent a practice, a lawyer, an address, a result, a testimonial, a logo wall, or a price.

Status: BRANCH-IMPLEMENTED on Next.js 16.4.5. Demo form is hidden when no destination is configured, and the old route returned 503 without storing a request. WORKING-TREE can show a local booking form when `DEMO_BOOKING=local` and `ASSAR_API_URL` is exactly `http://127.0.0.1:4000` or `http://localhost:4000`. Success copy must say the row was saved on this computer and that nothing was emailed or calendared. A non-https `DEMO_REQUEST_ENDPOINT` fails closed.

Workflow: W9.

Acceptance: see section 12. Publication as an advertisement still needs an advocate. The public footer is the short notice. The long note lives in the module PRD.

### 6.14 Restricted matters, audit, break-glass, backups

Purpose: a restricted matter is an access list. Audit rows record actor, action, and target. Break-glass is not a hidden superuser password in this tree; access is an explicit grant. Backup scripts exist (`scripts/backup-mongo.sh`, `backup-prune.sh`, `backup-verify.sh`, `restore-mongo.sh`). A script’s existence is not a restored-backup guarantee. No production backup has been restored in this work.

Status: BRANCH-IMPLEMENTED for access rows, audit, and rate limits. Restore proof is UNKNOWN.

### 6.15 Group 3, still gated

| Item | Status |
| --- | --- |
| Live automatic court, CNR, or cause-list feed | Not built. Manual card plus, in the working tree, an import of rows the firm already holds. |
| Live WhatsApp | Adapter is BRANCH-IMPLEMENTED and default off. Account, token, phone id, app secret, verify token, approved template, HTTPS, and consent are still required. |
| Live email | Not sent. Working tree can hold a local copy or stop at the SMTP gate. |
| Production n8n | Templates and a disposable test only. |
| Configured public demo booking | Not live. Working tree local slots are a synthetic computer booking. |
| Payment gateway | Deferred. Not built. Owner’s API after the local demo. |
| Court-specific forms | Working tree is a draft plus a human signoff. `licenseCheck` is always `not_performed`. Not certified. |
| Owner UAT, pull request, merge, deploy | Not done. |

Code that returns `external_activation_gate` is a hook. It is not the live service.

## 7. Workflows

Failure states are part of the workflow. A green label is not implied.

### W1 — Intake to a matter the client can see

1. Owner invites a person. The raw token is returned once. The stored value is a hash. Expired, revoked, and reused tokens fail.
2. The person accepts and sets a password. The role is the role on the invitation. The body cannot upgrade it.
3. Staff create a client. WhatsApp opt-out is a date on the client, default empty.
4. A conflict check is run and a person reviews it. The software does not clear the conflict.
5. A matter is opened, a team or lead may be set, and restricted access is an explicit list.
6. Court fields, if any, are typed. Provider lookup is not performed.
7. Document requests and tasks are created inside the matter.
8. Portal visibility and each document version share are separate switches. Default is hidden.

Failures: cross-firm id, missing CSRF on a browser unsafe call, MFA enrollment incomplete, intern without an access row.

### W2 — Hearing outcome

1. A hearing event is manual.
2. A person saves result, notes, and an optional next date. Review status becomes `draft`. Saving again clears a previous review.
3. Owner or attorney marks it reviewed.
4. A lawyer may create the next hearing as another manual event.
5. Audit records the review. Nothing is published to the portal by that action.

Failures: paralegal or intern review attempt, outcome on a non-hearing, a next date treated as a filing.

### W3 — Typed deadline

1. Choose the matter, the label (`limitation` or `other_deadline`), the due day, and the reason.
2. Submit for approval.
3. A lawyer approves or rejects. History stores actor, action, and time.
4. Reminders are in-app, on the stored offsets, using Asia/Kolkata dates. Default offsets are 7, 3, 1, and 0 days.
5. An edit requires approval again.
6. Close is a human status, not a court order.

Failures: approval by a non-lawyer, a model asked for a limitation period, a reminder sent by email or WhatsApp from this register.

### W4 — Document

1. Validate filename, allow-listed content type, and size.
2. Allocate a version and a storage key `org/{org}/matter/{matter}/doc/{doc}/v{n}-{token}`.
3. The client uploads to a signed URL. The complete call checks the object. A mismatch deletes the object.
4. Scan. States are `pending_upload`, `scanning`, `clean`, `infected`, `scan_failed`, `skipped`. `skipped` is not `clean`. Production forbids a disabled scanner.
5. Extract text or OCR into `documenttexts`. The text is as sensitive as the file.
6. A template render is a draft. Review, then an explicit share. Export is not a filing.

Failures: executable type, path traversal, scanner outage, signed URL for another object, download by a portal user of an unshared version.

### W5 — Intern

1. A supervisor assigns a task on a matter. That assignment is what creates the intern’s access.
2. The intern lists only those matters and updates only own task status.
3. Revocation removes the access. The intern does not approve law, does not browse billing, and does not read other matters’ documents.

Failures: id guessing returns 404, not 403, so existence does not leak.

### W6 — Outbox

1. Draft with consent `optedIn: true` and `namesFirm: true`.
2. Lawyer approves or rejects the content.
3. Preflight: opt-out, missing address, template pair, WhatsApp window, provider configuration.
4. Outcomes stay distinct: `pending_approval`, `rejected`, `mock_delivered`, `external_activation_gate`, and in the working tree `held_local`. Provider statuses `accepted`, `sent`, `delivered`, `read`, `played`, and `failed` are for a real provider callback. Mock acknowledgement cannot promote a gated row to sent.
5. Webhooks are signed, replay-safe, and idempotent. WhatsApp uses `X-Hub-Signature-256` over the raw body. The mock webhook signs `timestamp + '.' + JSON.stringify(body)` and is sensitive to key order.

Failures: missing key, unsafe host, opt-out, template only half specified, replay, a service token approving the text.

### W7 — Invoice and manual money

1. Time entries use the firm currency. Mixing currencies is a conflict.
2. Draft invoice, lines, tax rate typed by a person.
3. Working tree: tax above zero needs `accountantReviewedAt` before issue.
4. Issue assigns a number. Portal can see issued and paid invoices.
5. A person records a payment with an idempotency key. Overpayment and a second different body with the same key fail.
6. Aging and CSV are reports. They are not a tax return.
7. Void is a status. It does not move money at a bank.

Failures: duplicate payment, edited approval, gateway charge. The gateway does not exist, so a charge cannot succeed.

### W8 — Local automation

1. `WORKFLOWS_ENABLED` is false until a person turns it on.
2. The worker rejects an example host.
3. A disposable n8n can run the JSON templates against the local API, Mongo, and Redis.
4. Service-token output is audited. Retries do not create a second task when the dedupe key matches.

Failures: workflows left on by accident, secret in a log, token used as a lawyer.

### W9 — From the local candidate to a release

1. Boot the synthetic stack on the operator’s computer. Cloud localhost is not that computer.
2. Walk the synthetic journey in section 14.
3. Owner UAT against this document’s matrix. Gaps are triaged. They are not marked passed.
4. Merge, deploy, and publication are separate approvals. None is implied by a green local test.

## 8. Data

### 8.1 What was verified

On this worker, Mongoose model names were loaded from `packages/database/dist` and each `collection.collectionName` was printed. The schema fields and indexes below were read from `packages/database/src/models/index.ts` in the working tree. `unique: true` on a field also creates an index; those are listed when the field line was read.

Committed `7d7efdf` does not contain `CourtImport`, `LocalMailbox`, `DemoBooking`, or `CourtForm`. It also does not contain invoice `accountantReviewedAt` / `accountantReviewedBy`, outbox status `held_local`, or providers `local_mailbox` and `smtp`. Those are WORKING-TREE.

No production migration was written. No production data was touched.

### 8.2 Verified collections

| Model | Collection | Scope note |
| --- | --- | --- |
| Organization | `organizations` | `slug` unique, pattern `[a-z0-9-]{3,50}`. Billing subdocument defaults currency `USD`, tax 0, due 30 days. |
| User | `users` | `email` unique. `passwordHash` required. MFA secret is encrypted, never plaintext. Recovery codes are hashes. |
| Membership | `memberships` | Unique `(organizationId, userId)`. Role enum is the seven staff roles. |
| Session | `sessions` | TTL on `absoluteExpiresAt`. Index on `userId`. |
| Invitation | `invitations` | TTL on `expiresAt`. Index `(organizationId, email)`. |
| AuditLog | `auditlogs` | `(organizationId, _id)` and `(organizationId, action, _id)`. |
| IdempotencyKey | `idempotencykeys` | Unique `(organizationId, key)`. TTL on `expiresAt`. |
| Client | `clients` | Indexes on org plus id, status, normalized name, and tokens. `whatsappOptOutAt`. |
| Team | `teams` | Unique `(organizationId, normalizedName)`. |
| Matter | `matters` | Unique `(organizationId, matterNumber)`. Court subdocument: name, case number, judge, courtroom, jurisdiction, `filedOn` `YYYY-MM-DD`, `cnr` 16 of `A-Z0-9`, `officialUrl`, `trackingSource` only `manual`, freshness `unverified` or `verified_manual`. Also `restricted`, `portalVisible`. Indexes include `court.cnr` and `court.name`. |
| MatterAccess | `matteraccesses` | Unique `(organizationId, matterId, userId)`. |
| Party | `parties` | `(organizationId, matterId, _id)` and token index. |
| Counter | `counters` | Sequence for numbers. |
| ConflictCheck | `conflictchecks` | `(organizationId, _id)`. |
| Document | `documents` | Title and `latestVersion`. Bytes are not in this row. |
| DocumentVersion | `documentversions` | Unique `(organizationId, documentId, version)`. `storageKey`. Status enum in section 7 W4. `clientVisible` default false. |
| DocumentText | `documenttexts` | Unique `(organizationId, versionId)`. Text index with `default_language: none`. Cap `MAX_STORED_TEXT_CHARS` 2,000,000. |
| DraftTemplate | `drafttemplates` | Unique name per org. Partial unique `starterKey`. |
| CalendarEvent | `calendarevents` | Kind enum includes `hearing`. `source` only `manual`. Outcome subdocument with `reviewStatus` `draft` or `reviewed`. |
| Task | `tasks` | Index `(organizationId, assigneeId, status, _id)`. |
| AiJob | `aijobs` | Queue state. |
| AiOutput | `aioutputs` | Unique `jobId` per org. `reviewStatus`. |
| ClientUser | `clientusers` | Unique `(organizationId, email)`. |
| PortalInvitation | `portalinvitations` | TTL on `expiresAt`. |
| ServiceToken | `servicetokens` | Index `(organizationId, status)`. |
| Notification | `notifications` | Partial unique `(organizationId, dedupeKey)`. |
| TimeEntry | `timeentries` | Indexes on work date, matter and status, user, invoice. |
| Invoice | `invoices` | Status `draft`, `issued`, `paid`, `void`. Amounts are integer cents. Partial unique number per org. WORKING-TREE accountant review fields. Payments are embedded, each with amount, time, method, optional reference, and `recordedBy`. |
| Deadline | `deadlines` | Status `draft`, `pending_approval`, `approved`, `rejected`, `closed`. `dueOn` is a string day. History array. |
| Outbox | `outboxes` | Consent object. `providerTemplateApproval` is `not_claimed`. Unique sparse `providerMessageId`. Webhook event ids stored on the row. |
| CourtImport | `courtimports` | WORKING-TREE. Unique `(organizationId, sourceName, externalId)`. |
| LocalMailbox | `localmailboxes` | WORKING-TREE. Unique `(organizationId, outboxId)`. |
| DemoBooking | `demobookings` | WORKING-TREE. Unique `slotStart` with no organization id. These rows are a local demo, not a firm’s case file. |
| CourtForm | `courtforms` | WORKING-TREE. Index `(organizationId, _id)`. `licenseCheck` enum is only `not_performed`. |

### 8.3 Logical families and candidate indexes

These families are the design map. They are not extra collections beyond section 8.2.

| Family | Where it lives now | Candidate index, not claimed to exist unless named above |
| --- | --- | --- |
| Firm and settings | `organizations.billing` | None proposed. |
| User, membership, invite, session | the four collections | Existing uniques are the control. |
| Client, consent, portal | `clients`, `clientusers`, `portalinvitations` | A portal-user lookup by client id exists. |
| Matter, parties, team, restricted | `matters`, `parties`, `teams`, `matteraccesses` | Existing. |
| Court record, source, freshness | `matters.court`, plus WORKING-TREE `courtimports` | Feed cursor per source: proposed only if a real provider is approved. |
| Hearing outcome and review | `calendarevents.outcome` | Existing start-time indexes. |
| Deadline, history, reminder | `deadlines` | Existing `(organizationId, status, dueOn)`. A reminder-sent key is in notifications, not a second deadline index. |
| Task assignment | `tasks` | Existing assignee index. |
| Document version, share, private object, scan | `documents`, `documentversions`, storage key | Existing. |
| Template, jurisdiction, official version, approval | `drafttemplates` are not jurisdiction-locked. WORKING-TREE `courtforms` holds source title, URL, and retrieved day. | Proposed: `(organizationId, status)` on court forms if the list grows. Not created. |
| Time, invoice, currency, tax, manual payment | `timeentries`, `invoices`, `idempotencykeys` | Existing. |
| Outbox, approval, delivery, webhook | `outboxes`, WORKING-TREE `localmailboxes` | Existing status and client indexes. |
| Audit, jobs, workflow | `auditlogs`, `aijobs`, `notifications`, `servicetokens` | Existing. |

Proposed indexes are not in the schema. Do not document them as present.

Firm id on a write comes from the session. A reference from a matter to a client is checked in the same firm. Email on `users` is a global identity. Membership is the firm role. The same email is not a member of two firms in the current user unique index; that is a code fact, not a future SaaS design.

Money is integer cents. Tax is basis points from 0 to 10000. Dates that are court days are `YYYY-MM-DD` strings. Instants are `Date`. Enums are closed. A caller cannot add a status by sending a new string.

Idempotency keys and the invoice number counter are the atomic controls that were read. A general claim that every mutation is concurrency-safe is not made.

### 8.4 MongoDB is not a folder of files

- A MongoDB database is a named set of collections on the replica set. Dev and test URIs in this repo use database names `assar` or `assar_test` on `127.0.0.1:27117`, replica set `rs0`. The uncommitted demo script, if used later, targets `assar_demo`. That script was not run for this document.
- A collection is a set of documents. Those documents are records. They are not the PDF.
- The file bytes live in the storage adapter. Local driver root is `STORAGE_LOCAL_DIR`, default `./.data/storage`, resolved to an absolute path. The key shape is `org/{orgId}/matter/{matterId}/doc/{docId}/v{n}-{token}`. Production local disk is rejected. The S3 driver uses a private bucket. `.env.example` names `assar-private`. The unit test of the signer uses the same bucket name and does not open a network connection. This pass did not list a live bucket.
- UI “folders” are not an access-control list. Access is the matter check plus `clientVisible` on a version.
- Derived text is `documenttexts`, not a second public file.
- Scanner failure leaves the version `scan_failed` or, if scanning was not run, `skipped`. Neither state is clean, and production will not boot with scanning disabled.

Restart persistence: the historical test helper drops the test database on boot and calls `syncIndexes`. That proves tests start clean. It does not prove a demo document survived a mongod restart. That check is still NOT-RUN.

## 9. API catalog

Global prefix `/v1`. Excluded from the prefix: `healthz`, `readyz`, `internal/storage`. Pagination uses a cursor and a limit. Validation errors use the error body `{ error: { code, message, details, requestId } }`. Hidden resources are 404 where the tests already assert that. Missing staff session is 401. A permission failure is 403. This catalog lists routes that exist in the controllers. It does not invent names.

### 9.1 Health and storage

- `GET /healthz`, `GET /readyz`
- `PUT /internal/storage`, `GET /internal/storage` — signed local driver only

### 9.2 Auth and organization

- `POST /v1/auth/register|login|accept-invitation|logout|change-password`
- `GET /v1/auth/me`, `PATCH /v1/auth/profile`
- `GET /v1/auth/sessions`, `POST /v1/auth/sessions/revoke-others`, `DELETE /v1/auth/sessions/:id`
- `POST /v1/auth/mfa/setup|enable|disable`
- `GET|PATCH /v1/organization`, `GET /v1/organization/members`, `PATCH /v1/organization/members/:userId`
- `POST|GET /v1/organization/invitations`, `DELETE /v1/organization/invitations/:id`
- `GET /v1/audit-logs`

### 9.3 Work

- Clients: `POST|GET /v1/clients`, `GET|PATCH /v1/clients/:id`, `POST /v1/clients/:id/whatsapp-opt-out`
- Matters: `POST|GET /v1/matters`, `GET|PATCH /v1/matters/:id`, `POST /v1/matters/:id/court/verify`, access and parties routes under the same controller
- Teams, tasks, conflict-checks, timeline, calendar events including `outcome`, `outcome/review`, `schedule-next`
- Documents under `/v1/matters/:matterId/documents` and `/v1/documents/...` including complete, text, extract, similar, rescan, download-link, and `GET /v1/search/documents`
- Templates: list, get, create, patch, `POST /v1/templates/:id/render`
- AI under `/v1/ai` — jobs, outputs, edit, approve, reject. Default off.

### 9.4 Practice modules (BRANCH-IMPLEMENTED)

- `GET /v1/courts/provider` — activation gate, lookup not performed
- Deadlines: list, create, patch, submit, approve, reject, close, `POST /v1/deadlines/reminders/run`
- Outbox: list, create, approve, retry, reject
- `POST /v1/webhooks/messages/mock`
- `GET|POST /v1/webhooks/whatsapp`

### 9.5 Working-tree activation routes

These are not in `7d7efdf`.

- `GET /v1/courts/feed`, `GET|POST /v1/courts/imports`
- `GET /v1/demo-bookings/slots`, `POST /v1/demo-bookings` — public, auth-rate throttled, 503 when `DEMO_BOOKING` is not `local`
- `GET|POST /v1/court-forms`, `POST /v1/court-forms/:id/signoff` — signoff requires `form:approve`
- `GET /v1/mailbox`
- `POST /v1/invoices/:id/accountant-review`

`GET /v1/courts/provider` stays the gate. The new feed route does not replace it.

### 9.6 Billing and portal

- Billing settings and member rate
- Time entries and reports: time, time export, billing summary, aging
- Invoices: create, list, get, patch, delete draft, lines, issue, payments, void, reminders
- Portal auth and the signed-in client’s matters, documents, download-link, invoices, messages, AI outputs
- Staff portal admin: invitations, access, matter visibility, document share, AI share

### 9.7 Automation

- `GET /v1/automation/reminders/due`, `POST /v1/automation/notifications`, `POST /v1/automation/tasks`, matter context, daily report
- Notifications read
- Service tokens: scopes, create, list, delete
- `GET /v1/system/workers`

### 9.8 Environment names only

No values belong here.

WhatsApp: `MESSAGE_PROVIDER`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `MESSAGE_WEBHOOK_SECRET`.

Email: `EMAIL_DELIVERY`. SMTP host variables are not read.

Demo: `DEMO_BOOKING`, `ASSAR_API_URL`, and the older `DEMO_REQUEST_ENDPOINT` only for an https inbox when booking is not local.

Court: `COURT_FEED`.

Workflow: `WORKFLOWS_ENABLED`, `N8N_WEBHOOK_BASE_URL`, `N8N_WEBHOOK_SECRET`.

There is no payment-gateway variable.

## 10. Security threat model

This is a scoped design and regression list. It is not a claim that the system is unhackable, and it is not a penetration test.

### 10.1 Actors

Unauthenticated caller. Malicious staff member. Another firm. A client guessing an id. An intern escalating. A stolen session. A reused invite. A malicious file. A fake webhook. A service token used outside its route. A double payment. A job retry. A storage URL copied to another object. An audit log that kept a secret. A backup that was never restored.

### 10.2 Controls that exist in code

- Argon2id password hashes. MFA for three roles. Invitation expiry and revocation. Session cookies `httpOnly`. CSRF cookie echoed as `x-csrf-token`. Production cookies use the `__Host-` prefix. Browser `Origin` on unsafe methods must be in `CORS_ORIGINS`. Production rejects non-https origins, weak secrets, equal session and MFA keys, local storage, and a disabled scanner.
- Rate limits on auth and, separately, principal, service, and global windows.
- Zod schemas reject unexpected shapes. NoSQL operator injection is a validation failure when the field must be a string, which the activation test covers for `externalId` in the working tree.
- Upload allow-list, filename sanitation, size ceiling, signed URL, path confined to the storage root.
- Webhook raw-body signature, replay ids, and status order on the WhatsApp path.
- Audit on the practice actions that were read. Logs must not contain document text. A full log-redaction audit was not re-run for this document.
- Dependency pin: marketing `next` is exactly `16.4.5`. The prior session verified GitHub advisories rather than the npm bulk feed. Seven 3 Nov 2026 medium advisories affecting `>=16.4.0 <=16.4.4` are patched at 16.4.5, including GHSA-vvgp-ww4w-46vf. The 14 Oct critical and high items named in that session are patched at 16.4.1. September pages that print a patched token `16.3.?` were not used as a reason to leave 16.4. This document does not reopen that advisory pass.

### 10.3 Mandatory negative cases

Cross-firm read, write, export, and file. Unassigned, revoked, intern, and client-draft or other-case access. Expired, tampered, and cross-object signed URLs. Invalid dates, amounts, oversize files, unscanned files, scanner outage. Duplicate payment, duplicate job, edited approval. Replayed webhook. Opt-out, missing key, half a template, closed window. Disabled workflows and an unsafe webhook host.

Historical tests cover many of these. The matrix in section 13 says which ones were cited as passed and which were not re-run.

### 10.4 Not claimed

Encryption at rest of the Mongo volume, a tested restore, a retention schedule, a legal hold, and a lawyer’s sign-off on the threat model. Those remain requirements. They are not evidence.

## 11. Legal reference boundary

The owner pointed at `/workspace/assar-law-firm/legal-reference/` and `Assar-legal-reference-2026-11-07.zip`. Neither path is on this worker. The pack, as previously described, is a registry of 17 items. Three original official full texts were read in that earlier research: the DPDP rules GSR 843 and criminal procedure SO 848, 849, and 850, plus two GST entries. That count is the owner’s research note. This document does not re-certify it and does not paste the texts.

Still required before any form, deadline, or filing is treated as real:

- The state, the court, the case type, and the material dates.
- The current official source for each template: title, URL, version, and the date it was retrieved.
- A licensed advocate’s approval. Software `form:approve` records a declaration. `licenseCheck` stays `not_performed`.
- CPC, transition and savings, limitation exclusions, condonation, holidays, court forms, fees, stamp, notary, e-sign, Bar Council confidentiality, privilege, conflicts, and marketing rules. All of these are conditional. None is assumed approved.
- DPDP duties are conditional on the firm’s role and on current rules. This product does not implement a compliance badge.

The public site does not claim a legal result. Publication as an advertisement still needs advocate review. The research note on Bar Council Rule 36 is not a certified copy of the rule.

## 12. Landing and motion

Pages that exist: Home, Services, Solutions, Pricing, Contact, plus staff and portal entry links. Integrations are described only as far as the product actually connects. No invented lawyer, address, practice area, result, testimonial, logo, or price. `publishedPrice` stays null. Product images are synthetic and labelled. The unconfigured demo does not show a form and does not store a request. The working-tree local booking is a separate, labelled path.

Skills that govern the page: pro UI design, anti-AI look, and purposeful motion. Brand stays the existing navy and accent. Default purple is not introduced. At most one to three motions on a page. Motion is transform and opacity, normally at most 200 ms. Essential text is not hidden until JavaScript runs. Reduced motion gets the final static state.

The twelve named patterns, accounted honestly:

| Pattern | Decision | Why |
| --- | --- | --- |
| Hero reveal | BRANCH-IMPLEMENTED | `.support-in` / `rise`, 200 ms, on the eyebrow. Reduced motion sets the animation to none. The prior session measured that. This pass did not re-record it. |
| Word rotator | Not appropriate | Legal sentences must stay stable. |
| Sale pings | Not appropriate | There are no orders. |
| Review shuffle | Not appropriate | There are no permissioned reviews. |
| Count-up | Not appropriate | There are no source-backed metrics. Inventing them is forbidden. |
| Bento reveal | Not used | The page is not a bento. |
| Cursor tour | Deferred | The labelled synthetic screenshots already show the product. A fake cursor would pretend work happened. |
| Process draw | Deferred | The steps are a list. An SVG connector would not add a fact. |
| Before/after slider | Not appropriate | No authentic paired result assets. |
| Price roll | Not appropriate | No published price. |
| Us versus them | Not appropriate | No evidence-backed comparison, and it would be an advertising problem. |
| Click to success | BRANCH-IMPLEMENTED as a real form state, WORKING-TREE copy when local booking is on | Idle, sending, ok, and error follow the response. Success is not shown before the server answers. Local success must say the row was saved here and that mail and calendar were not written. |

Prior contrast figures from the 16.4.5 pass, not re-measured here: heading about 18.5:1, lede about 11:1, staff sign-in about 5.2:1, footer light text about 11:1, publication notice about 7.5:1. Tap targets after that commit: skip link and menu at least 44 px on the measured controls. A score table that marks every page 8 or above is not repeated here, because this pass did not rescore the working-tree form.

## 13. Competitor research

This is public-feature research for product judgment. It is not independent testing, and it is not a licence to copy code, screens, or copywriting. Prices and reviews move. Dates below are the dates the source itself showed, and several were already undated or unverified on 7 Nov 2026.

| Product | What the public page emphasises | What that means for Assar | Caution |
| --- | --- | --- | --- |
| [Clio](https://www.clio.com/features/) | Hosted cases, intake, calendar, documents, AI, billing, portal. | A full hosted suite is the category. Assar’s first job is one firm, with isolation, not a clone of every Clio module. | Capterra reviews at the linked page show individual plan names that do not match, cancellation friction, and undated comments. Not a universal bug list. |
| [MyCase](https://www.mycase.com/features/) | Cloud intake, workflows, e-sign, portal, billing. | Intake and a client portal are real jobs. E-sign is not in Assar. | “Latest release” claims were unverified. |
| [PracticePanther](https://www.practicepanther.com/law-practice-management-software/) | Hosted cases, templates, time, billing, payments, integrations. Individual complaints mention portal, documents, SMS, reporting, and API. | Payments are a later owner gateway, not a copy of this stack. | Trustpilot dates were unverified. |
| [Legodesk](https://legodesk.com/case-management-for-collections-legal-teams/) | India cloud product aimed at collections: notice, recovery, allocation, hearings, orders, audit. Vendor coverage figures of 10000 versus 19000 were unverified. | Hearing and order tracking matter in India. Assar still does not scrape a court. | Independent reviews were thin. |
| [j-lawyer](https://www.j-lawyer.org/?p=7499) | Official 3.5 notes dated 27 Apr 2026. AGPL-3.0, Germany, self-host or hosted, cases, documents, calendar, billing, email, AI, workflows, Office 365, REST, webhooks. | Self-hosting and a real case file are closer to this firm’s shape than a US SaaS. German beA filing is not an Indian court. | Do not call 3.5 the latest release. A filename issue was discussed on 16 Jun 2026. Format and calendar behaviour were individual reports, not an India-ready claim. Source: the project site and [github.com/jlawyerorg/j-lawyer-org](https://github.com/jlawyerorg/j-lawyer-org). |

US accounting exports are not Indian tax compliance. Other names from the 7 Nov notes — Vakeel Saathi, Lawgger, Legistify, LEAP, CARET — were not re-checked for this version. The historical comparison canvas is [this page](https://cursor.com/canvas/store-edd1e7b7-4ea9-46eb-a79c-85c12d5494cb/fffaa3fc-9078-4a4e-ab05-8072adb742f4). It was not re-fetched while writing this file.

## 14. Acceptance matrix

“Historical pass” means the prior session’s report says a test of that behaviour passed on the tree that became `7d7efdf`. It is not a fresh run. “Working-tree pass” means the uncommitted activation file’s 7 tests passed on this worker before this document was committed. “Not run” means this document does not have a command log for it.

| # | Given / when | Outcome | Evidence |
| --- | --- | --- | --- |
| 1 | Register with a taken email | Conflict, no second user | Historical auth tests. Not re-run. |
| 2 | Login, then logout, then reuse the session | 401 | Historical. Not re-run. |
| 3 | Privileged role before MFA | Enrollment block | Historical. Not re-run. |
| 4 | Invite expired, reused, or with a body role | Rejected; role stays the invited role | REQUIREMENT. A full negative set was not re-run for this file. |
| 5 | Staff of firm A reads firm B’s matter | 404 | Historical matters tests. Not re-run. |
| 6 | Client intake saved | Client row in that firm only | Historical. Not re-run. |
| 7 | Conflict check | Stored for a person to read; no auto-clearance | BRANCH-IMPLEMENTED route. Fresh assertion not re-run. |
| 8 | Court card with a bad CNR or http URL | 400 | Historical. Not re-run. |
| 9 | `GET /v1/courts/provider` | `external_activation_gate`, lookup not performed | Historical assertion. Working-tree suite still expects that body. |
| 10 | Import a cause-list row | Stored, not applied to a matter; no network | Working-tree pass. Not in `7d7efdf`. |
| 11 | Replay the same import payload | `replayed` | Working-tree pass. |
| 12 | Change the payload without retry | `conflict` | Working-tree pass. |
| 13 | `retrievedAt` older than 7 days | `stale` | Working-tree pass. |
| 14 | Operator object in `externalId` | 400 | Working-tree pass. |
| 15 | Hearing outcome by a paralegal, review by an attorney | Draft, then reviewed | Cloud journey, section 4.2. Paralegal review 403. Attorney review 201. |
| 16 | Schedule next | One manual hearing at the chosen IST instant | Cloud journey, section 4.2. Not a limitation calculation. |
| 17 | Deadline approve by intern or paralegal | 403 | Cloud journey, section 4.2. Both 403. Attorney approve 201. |
| 18 | Deadline edit after approval | Needs approval again | REQUIREMENT. Confirm in the next test pass; not re-run here. |
| 19 | No route computes a limitation period | Absent | BRANCH-IMPLEMENTED by absence. Not a certificate. |
| 20 | Upload executable type or a path-like name | 400, name sanitised | Cloud journey rejected the executable with 400. Path sanitising was the section 4.1 check, not repeated as a second file. |
| 21 | Scanner cannot run | Not marked clean | Cloud journey status `skipped`. Portal share 409. Not marked clean. |
| 22 | Signed download for another object | Rejected | REQUIREMENT. Not re-run as a dedicated case in this pass. |
| 23 | Intern sees only the assigned matter | Other matter 404 | Cloud journey API 404 and the staff screen “you do not have access.” |
| 24 | Intern revoked | Access gone | REQUIREMENT. Not re-run here. |
| 25 | Outbox without consent | Rejected | Historical. Not re-run. |
| 26 | Approve with mock provider | `mock_delivered`, no socket | Cloud journey. Provider `mock`. No socket. |
| 27 | Approve with provider unset | `external_activation_gate` | Historical. Not re-run. |
| 28 | Local email mode | `held_local`, mailbox row, no socket | Cloud journey. Status `held_local`, provider `local_mailbox`. The portal does not show that row. |
| 29 | SMTP mode | Gate, `smtp_send_not_enabled`, no socket | Working-tree pass. |
| 30 | Mock webhook bad signature or replay | Rejected or ignored | Historical. Not re-run. |
| 31 | WhatsApp missing key, template, window, or opt-out | Not sent | BRANCH-IMPLEMENTED adapter tests used fake fetch. Not re-run. |
| 32 | INR selected by a person; tax 0 | Issue allowed; no invented GST | Historical billing. Not re-run. |
| 33 | Tax above 0 without accountant review | 409, then issue after review | Cloud journey. Billing user reviewed, then issued. 18% was typed. Currency INR. |
| 34 | Duplicate payment key | No second ledger line | Historical idempotency. Not re-run. |
| 35 | Portal client sees a draft or another client | Hidden or 404 | Cloud journey. Other matter hidden. Draft invoice absent. Local email absent. Mock update and paid invoice visible. |
| 36 | n8n example host | Worker rejects it | Historical. Not re-run. |
| 37 | Disposable n8n | 6 tests passed on 1.123.92 | Historical. Binary may be gone. UNKNOWN today. |
| 38 | Landing keyboard, 44 px, reduced motion | Measured on the 16.4.5 commit for the controls named in the report | Landing evidence stays section 4.1. Staff and portal 44px, Tab, 390, and reduced motion are section 4.2. |
| 39 | Unconfigured demo | No form, nothing stored | BRANCH-IMPLEMENTED. |
| 40 | Local demo slot booked twice | 201 then 409, notification `not_sent` | Working-tree pass. |
| 41 | Court form signoff by paralegal, service token, attorney | 403, 401, then `legally_approved` with `licenseCheck` `not_performed` | Working-tree pass. |
| 42 | Cold start, `/readyz` when Mongo is down, then up | 503 then 200 | Section 4.2, owned mongod only. 503 `mongodb: failing`, then 200. |
| 43 | Restart mongod and read the same synthetic document | Still present | Section 4.2. Journey matter and 23-byte file survived. Foreign `/tmp/mongo-data` was not restarted. |
| 44 | Full browser journey: intake, matter, private file, hearing, deadline, intern denial, mock message, INR invoice, manual payment, portal | Each step on one running stack | Cloud-local pass, section 4.2. Portal file remains blocked until a scan is `clean`. Not owner UAT. |
| 45 | Owner UAT | Signed by the owner | NOT-RUN. |
| 46 | Restore a backup and verify | Counts match | NOT-RUN. Script exists only. |
| 47 | Payment gateway charge | Must not exist | Confirmed absent. Deferred. |
| 48 | Merge and production deploy | Not performed | Gate remains. |

Rows 1–48 are the matrix. Historical passes are not a pass of every row.

## 15. Local handoff

The owner’s computer was offline. Anything running in this cloud worker is not that computer. The owner runs the stack later. Version 1.0 of this section had not executed `scripts/local-demo.sh`. Section 4.2 did, on this worker only, against `/workspace/.data/demo-mongo` and port 27119.

### 15.1 What the owner’s machine needs

- Node 22 or newer, pnpm 9.11.0, a local MongoDB 7 that can be a replica set, Redis 7.
- No production secrets. Demo mode stays `NODE_ENV=development`. Production auth checks are not disabled.
- App ports: marketing 3000, dashboard 3001, portal 3002, API 4000, worker health 4100. Mongo and Redis are 27117 and 6380 only when those ports are free or already serving this demo’s directories `.data/mongo` and `.data/redis`. If another program owns the port, the script leaves it running and uses `.data/demo-mongo` on the first free port in 27119–27122, and `.data/redis` on the first free port in 6382–6384. Read `.data/demo-services.env` for the ports actually chosen. `mongod` must be on PATH, or the script prints the binary it found and exits if it finds none.
- Health: `GET /healthz` is liveness. `GET /readyz` checks Mongo and Redis. A dependency that is down is a failed ready check, not a hidden success.
- Login material, if the seed is run, is written only to `.data/demo-login.txt` on that machine. This document does not contain a password, a TOTP secret, or a recovery code.
- Registration may be on only long enough to seed, then the API must be restarted with it off. Invite remains the normal path.
- Staff sign-in uses email, password, and MFA where the role requires it. Portal sign-in uses the organization slug, email, and password.
- Open the dashboard at the same host family as `VITE_API_URL`. A page on `127.0.0.1` calling an API on `localhost` does not send the cookie.

### 15.2 Journey to walk after the stack is actually up

Intake a synthetic client. Open a matter. Upload a private file and download it through the signed link. Record a hearing and a lawyer review. Approve a typed deadline and a task. Sign in as the intern and show the other matter is absent. Approve a message and show it did not leave the machine. Issue an INR invoice at tax 0 and record a manual payment. Release the matter to the synthetic client and show the portal. Restart Mongo and read the matter again. Stop Redis and show `/readyz` fail, then recover.

Feature tests come first. Owner UAT is next. A client presentation is after that. No gateway call and no external send are part of the journey.

### 15.3 Commands the next session should record

Exact command, exit code, skip reason, and whether Turbo used a cache. Empty web and UI test scripts are not coverage. Do not call a live provider and describe the result as an end-to-end test.

## 16. Approvals, non-goals, and blockers

Do not do these under this document: cover every court, give legal advice, scrape, bypass a captcha, point at a production database, deploy, merge, message a real person, take a charge, commit a secret, invent proof, or add a payment gateway.

Still blocking a production claim:

- Meta keys and an approved template, if WhatsApp is ever turned on.
- The firm’s state, court, and case type, plus a lawyer’s sign-off on forms and on publication.
- Provider consent for any court feed.
- Collaborator permission before a pull request exists.
- Remote CI on the branch, which is UNKNOWN.
- Owner UAT.
- A separate merge approval and a separate deploy approval.
- A backup that has been restored and checked.

These blockers are not a reason to stop local work that does not need them. The next session should keep going on the localhost journey and the matrix rows marked NOT-RUN.

Questions that are still one list, not a drip:

1. Legal name, city, and whether any practice may be named in public.
2. Fee display: remain “no published price”, or a later page the advocate approves.
3. Retention and who may export a matter.
4. Whether the friend firm will use INR from the first invoice.
5. Which of the seven roles will actually be staffed.
6. Who the accountant is for a non-zero tax rate.
7. Whether a court feed will ever be an authorised file drop, or will stay typed.
8. The owner’s gateway choice, later, with its own security review.

## 17. Next session

1. Read this file.
2. Stay on `cursor/approved-practice-modules-d89d`.
3. Record `git rev-parse HEAD` and say whether it is still `7d7efdf` or a descendant.
4. Walk the feature registry and mark BRANCH-IMPLEMENTED, WORKING-TREE, or LIVE-GATED from the tree, not from memory.
5. Re-check the collection list if models changed.
6. Run the real local stack and the journey in section 15.
7. Attach command logs to the execution report outside the repo.
8. Hand the matrix to the owner for UAT.
9. Leave external gates closed.
10. Do not touch WIMO.

This PRD does not authorise new application behaviour. Implementation continues only under the 10:18 request, as narrowed at 10:21.

## 18. Changelog

| Version | When | Change |
| --- | --- | --- |
| 1.0 | 8 Nov 2026 | First master PRD. Cutoff 10:23 IST for owner decisions. Code facts verified later the same day on this worker and labelled. |
| 1.0.1 | 8 Nov 2026 | Correct the closed-decision line that said WIMO and its marketing site were paused. Only WIMO development is paused. Existing WIMO marketing routines remain untouched and are not paused. No WIMO file was changed. |
| 1.0.2 | 8 Nov 2026 | Record the cloud-localhost checks from the continuation. Not owner UAT. Not a security or legal certificate. The code commit is named in section 4.1. |
| 1.0.3 | 8 Nov 2026 | Record the connected cloud-local journey, the 44px staff and portal measurements, the owned data directories, and the fresh production build. Implementation commit `b98c20a37d24c7f47b7cefb54f980dd82089e905`. Not owner UAT. Not a security or legal certificate. |

## 19. Provenance

| Source | Use |
| --- | --- |
| Owner instructions 7–8 Nov 2026, including the 10:18, 10:21, and 10:22 notes and this write request | Scope, gates, deferrals, and the demand for status labels. |
| `packages/types/src/index.ts`, `packages/database/src/models/index.ts`, API controllers, `packages/storage/src/local.ts`, `apps/api/src/documents/documents.service.ts`, `apps/api/src/practice/practice.service.ts` | Roles, collections, routes, storage keys, court gate. |
| Mongoose `collectionName` printed from `packages/database/dist` | Section 8.2 names. |
| `docs/prd/approved-practice-modules.md` | Module fulfilment already accepted as the 7 Nov note. |
| `/opt/cursor/artifacts/assar-practice-modules-review-7d7efdf.md` and the named PNGs | Historical evidence. Not re-measured. |
| Competitor URLs in section 13 | Research citations. Not re-fetched for this version. |
| Canvas review page from the prior session | [Historical review](https://cursor.com/canvas/store-edd1e7b7-4ea9-46eb-a79c-85c12d5494cb/677a55e3-5588-4946-bbf0-803053aa97aa). Not re-fetched. |

Code-fact corrections against the owner’s consolidated brief, labelled so they are not silent edits:

- CORRECTION: there is no staff role named `client`. Portal users are a separate model.
- CORRECTION: `billing` includes `matter:read` in the static map. It does not include `document:read`.
- CORRECTION: no payment-gateway interface was found to preserve. Deferral is “do not build”, not “keep an existing contract”.
- CORRECTION: four collections and the accountant-review fields are working-tree only. They are not in `7d7efdf`.
- CORRECTION: `demobookings.slotStart` is unique globally, not per firm.
- CORRECTION: Mongoose collection `matteraccesses` is the real name. It is not `matter_access`.
- CORRECTION: this file was not saved by the earlier failed writes. Presence is proved only by the read-back recorded with the commit that adds it.
- CORRECTION (1.0.1): version 1.0 said “WIMO and its marketing site are paused.” That sentence was misleading. Only WIMO development is paused. Existing WIMO marketing routines must remain untouched and are not paused. This correction does not authorise any edit outside this repository.
