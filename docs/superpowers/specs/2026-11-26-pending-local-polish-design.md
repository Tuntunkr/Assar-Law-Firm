# Pending local polish — design

## Goal

Close the remaining **implementable** local-demo gaps without unlocking live providers, a payment gateway, merge, deploy, or a PR workaround.

## Out of scope (stays gated)

- Payment gateway
- Live court feed, live WhatsApp, live SMTP
- Production n8n
- WIMO development
- Broad MongoDB server-auth feature
- Owner UAT, merge, deploy, PR collaborator workaround

## In scope (this track)

1. **Hearing outcome UI** — replace `window.prompt` with the existing `@assar/ui` Modal pattern (result select + notes + optional next date).
2. **Deadline edit after approval** — PRD requires an edit to return the date to a state that needs approval again. Code today refuses edits when status is `approved` / `pending_approval`. Change: allow edit → reset to `draft` (must submit and approve again). Closed stays locked.
3. **Intern revoke** — add an API test: assign intern → can read matter → clear open assignment → replace access without them → matter 404. Fix only if the test fails.
4. **Signed download other object** — already covered in `documents.test.ts` (key swap → 403). Re-run that focused file; no product change unless it fails.
5. **Backup restore proof** — on a disposable empty DB only (`assar_backup_verify`), not `assar_demo` and not foreign `/tmp/mongo-data`. Record commands and counts. Skip if `mongodump`/`mongorestore` are unavailable; document the exact prerequisite.

## Success

- Focused tests pass; dashboard typecheck/lint for touched files pass.
- PRD matrix rows 18 and 24 updated with this commit’s evidence; row 22 marked re-run.
- Gates above remain closed.
