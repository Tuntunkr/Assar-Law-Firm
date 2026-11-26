# Pending local polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close implementable local-demo gaps (hearing outcome modal, deadline re-approval after edit, intern revoke evidence, signed-download re-run, optional backup restore proof) without unlocking gated providers.

**Architecture:** Keep staff Calendar UI on the existing Modal pattern. Align deadline update with the PRD rule that an edit of an approved date returns it to draft. Add focused API tests next to `practice-modules` / `documents` suites. Backup proof uses a disposable DB name only.

**Tech Stack:** NestJS API, Vite React dashboard, Vitest, `@assar/ui` Modal, existing Mongo backup scripts.

## Global Constraints

- Do not unlock live court, WhatsApp, SMTP, payment gateway, or production n8n.
- Do not add broad MongoDB server auth.
- Do not merge, deploy, or work around the PR collaborator refusal.
- Do not touch WIMO marketing or other repos.
- Do not drop or restore into `assar_demo` or foreign `/tmp/mongo-data`.
- Branch prefix: `cursor/<name>-d89d`. Additive commits only.

---

### Task 1: Hearing outcome Modal

**Files:**
- Modify: `apps/dashboard/src/pages/CalendarPage.tsx`
- Test: `apps/dashboard` existing vitest if calendar covered; otherwise manual typecheck

- [x] Replace `window.prompt` with `OutcomeModal` using result select (`HEARING_RESULTS`), notes textarea, optional `nextHearingOn` date.
- [x] Keep `recordOutcome` payload shape; preserve Review button behaviour.
- [x] `pnpm --filter @assar/dashboard exec vitest run` and typecheck.

### Task 2: Deadline edit after approval

**Files:**
- Modify: `apps/api/src/practice/practice.service.ts` (`updateDeadline`)
- Modify: `apps/api/test/practice-modules.test.ts` (or new focused test)

- [x] Allow edit when status is `draft`, `rejected`, `pending_approval`, or `approved`.
- [x] On edit, set status to `draft` and push history `edited`.
- [x] Keep `closed` locked with 409.
- [x] Test: approve → PATCH title → status `draft` → submit → approve again. Closed edit stays 409.

### Task 3: Intern revoke + signed download re-run

**Files:**
- Modify: `apps/api/test/practice-modules.test.ts` (add revoke case)
- Re-run: `apps/api/test/documents.test.ts` upload/signed-URL describe

- [x] Assign intern via task → GET matter 200 → clear assignee → PUT access without intern → GET matter 404.
- [x] If product fails, fix the smallest revoke path (unassign + access replace).
- [x] Re-run documents signed-URL security block; expect key-swap 403.

### Task 4: Backup restore proof (if tools present)

**Files:**
- Docs only unless scripts need a path fix: `docs/prd/...`, handoff

- [x] Disposable `assar_backup_source` → encrypted dump → `assar_backup_verify`; counts matched; both DBs dropped.
- [x] Tools used from MongoDB Database Tools 100.9.4 under `/tmp` (not committed).
- [x] Matrix row 46 updated for disposable proof only.

### Task 5: Docs + push

- [ ] Update PRD matrix rows 18, 22, 24 and a short section 4.4.
- [ ] Commit code then docs; push `cursor/pending-local-polish-d89d`.
- [ ] No PR unless collaborator access exists (refusal stands).
