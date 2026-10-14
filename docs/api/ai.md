# API: AI Copilot (v1)

Conventions are in `auth-and-organizations.md`. All AI work is **asynchronous** and runs in `apps/worker`; the API only records jobs and enqueues them. The Grok credentials (`GROK_API_KEY`, `GROK_MODEL`) exist **only in the worker's environment**.

## Safety model

1. **Authorized sources only.** A job names up to 10 documents from one matter the requester can access. Each is pinned to an exact version that has passed the virus scan. The model sees nothing else (no web, no other matters, no other organizations).
2. **Access is checked twice**: when the job is created and again when it runs (access may be revoked while it waits; the job then fails with `ACCESS_REVOKED` and the model is never called).
3. **Everything is a draft.** Outputs are stored with `reviewStatus: "draft"`, `aiGenerated: true` and a label saying so. Only an explicit call by a user with `ai:approve` (attorney, admin, owner) can approve or reject, exactly once. A worker can never approve anything.
4. **No fabricated citations, facts or deadlines (enforced in code, not just in the prompt):**
   - The prompt forbids inventing authority, computing deadlines, or using outside knowledge, and treats document text as untrusted data.
   - Every claim must carry citations `{sourceId, quote}`. The server checks each quote against the real source text (case/space-insensitive). Failures are kept but flagged (`verified: false` with the reason), never silently dropped or trusted.
   - A `dateText` must literally appear in a verified quote. Dates are reported as written; the system never computes or infers them.
   - Case names / statutory citations in the output that appear in no source are listed in `verification.unsupportedAuthorities`.
   - Approving an output with any unverified item (or unsupported authority) requires `acknowledgeUnverified: true`; drafting output, which cannot be fully verified, always does.
5. **Truthful progress.** `status` is `queued → processing → succeeded | failed | cancelled`, written by the worker as it happens. While processing, `stage` is `extracting_text`, `generating` or `saving`. There is no percentage or ETA. Retry state is visible: `attempts`, `maxAttempts` and the last `error`.
6. **Privacy.** Prompts, answers and document text are never logged or put in audit entries or error messages. Audit entries hold ids, task names and counts only.

## Tasks

`summary`, `document_qa` (needs `instructions` = the question), `extraction` (parties, dates as written, key facts), `chronology`, `clause_review`, `drafting` (needs `instructions` = the brief; unknown facts become `[PLACEHOLDER: ...]`), `missing_info`.

## Source files

Supported: plain text, CSV, e-mail (.eml), DOCX and text-based PDF. Not supported (job fails with `UNSUPPORTED_FILE_TYPE` or `NO_TEXT_EXTRACTED`, nothing is sent to the model): legacy .doc/.xls, RTF, ODT, and scanned/image-only files (no OCR). Long documents are truncated to `AI_MAX_CONTEXT_CHARS` split across sources; truncation is recorded per source and noted in the result.

## Endpoints

|                                           | Permission                 |                                                                                                                                                                                                                                |
| ----------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /ai/jobs`                           | `ai:use`                   | `{task, matterId, documents:[{documentId, version?}], instructions?}` → **202** job. Optional `Idempotency-Key`. 503 `SERVICE_UNAVAILABLE` if `AI_ENABLED=false` or the queue is down; 429 above `AI_MAX_ACTIVE_JOBS_PER_ORG`. |
| `GET /ai/jobs`, `GET /ai/jobs/:id`        | `ai:use`                   | filters `matterId, status, task`; jobs on hidden restricted matters are excluded / 404.                                                                                                                                        |
| `POST /ai/jobs/:id/cancel`                | requester or `user:manage` | Queued jobs are removed immediately; a running job stops at its next checkpoint and its output is discarded.                                                                                                                   |
| `POST /ai/jobs/:id/retry`                 | requester or `user:manage` | Failed jobs only.                                                                                                                                                                                                              |
| `GET /ai/outputs`, `GET /ai/outputs/:id`  | `ai:use`                   | filters `matterId, reviewStatus, task`.                                                                                                                                                                                        |
| `PUT /ai/outputs/:id/edit`                | `ai:use`                   | Adds a reviewer's text next to the model's original (drafts only).                                                                                                                                                             |
| `POST /ai/outputs/:id/approve`, `/reject` | `ai:approve`               | Exactly once. Reject needs a `reason`.                                                                                                                                                                                         |
| `GET /system/workers`                     | `org:manage`               | Worker heartbeats and queue depth.                                                                                                                                                                                             |

## Retry behaviour

Transient problems (provider 5xx/429, timeouts, network, malformed model output) are retried with exponential backoff up to `AI_JOB_MAX_ATTEMPTS`. Permanent problems fail immediately: bad credentials (`AI_AUTH_FAILED`), rejected requests, unsupported/unreadable files, unavailable sources, revoked access. Error codes: `AI_PROVIDER_ERROR`, `AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_UNREACHABLE`, `AI_RATE_LIMITED`, `AI_AUTH_FAILED`, `AI_REQUEST_REJECTED`, `AI_BAD_RESPONSE`, `AI_OUTPUT_TRUNCATED`, `MODEL_OUTPUT_INVALID`, `SOURCE_UNAVAILABLE`, `ACCESS_REVOKED`, `UNSUPPORTED_FILE_TYPE`, `NO_TEXT_EXTRACTED`, `FILE_TOO_LARGE_FOR_AI`, `EXTRACTION_FAILED`, `WORKER_STALLED`, `QUEUE_UNAVAILABLE`, `INTERNAL_ERROR`.

## Limits and caveats

- Verification proves a quote exists in the source, **not** that the model's interpretation of it is right. Lawyers must still read the draft.
- The legal-authority check is a pattern heuristic (US-style citations and "X v. Y"); other citation formats can slip through.
- Prompt injection inside documents is mitigated (separate data block, explicit rule, no tools, nothing is auto-approved) but cannot be ruled out; this is why nothing leaves "draft" without a person.
- The Grok integration has been tested against a protocol-level fake of the chat-completions API, not the live service (no credentials were available). Check the model name and response format against your xAI account before relying on it.
