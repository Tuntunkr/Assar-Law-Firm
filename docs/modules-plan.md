# Mandatory modules: status and build plan

The five product modules every firm needs. Status is **as verified in the code**, not as hoped.

Legend: ✅ built and used by the dashboard · 🟡 API exists, no UI (or partial) · ❌ not built

## 1. Client & case management

| Requirement                                     | Status | Notes                                                                                                                                     |
| ----------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Separate client profile                         | ✅     | `/clients/:id`                                                                                                                            |
| Case history per client                         | ❌     | Needs a per-client/matter **timeline** (events from audit + status changes + documents + tasks).                                          |
| Case number, lawyer, team, status               | ✅     | `matterNumber`, `leadAttorneyId`, `teamIds`, `status`                                                                                     |
| **Court** (name, case no., judge, next hearing) | ❌     | Matter has no court fields. Add `court` subdocument.                                                                                      |
| All of a client's documents in one place        | 🟡     | `GET /v1/documents?clientId=` and the firm-wide Documents page (client filter) exist. A Documents tab on the client page is still to add. |
| AI quick summary of client's case history       | ❌     | New AI task `case_history` over a client's matters + approved outputs; stays a draft until approved.                                      |

## 2. Legal Document AI

| Requirement                                     | Status | Notes                                                                                                                      |
| ----------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| Upload PDF / Word / scans                       | ✅     | Dashboard `/documents` and the matter Documents tab: upload, scan status, versions, download, share with client.           |
| Extract text from PDF, Word, **scanned** files  | ❌     | No text-extraction or OCR in `packages/jobs` today. Needs an extraction step (pdf text layer, DOCX, OCR for images/scans). |
| Draft notices, contracts, petitions, agreements | 🟡     | `drafting` AI task exists; add **templates** and a drafting UI.                                                            |
| Long-document summary                           | 🟡     | `summary` task exists; no UI to run it from a document.                                                                    |
| Dates, parties, clauses, missing information    | 🟡     | `extraction`, `clause_review`, `missing_info`, `chronology` tasks exist.                                                   |
| Search similar previous documents               | ❌     | Needs a text index/embeddings over extracted text, org-scoped and matter-access-aware.                                     |

## 3. Court dates & task automation

| Requirement                                   | Status | Notes                                                                                                                                                               |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hearing / filing-deadline calendar            | ✅     | `/calendar`, event kinds `hearing`, `deadline`                                                                                                                      |
| Assign tasks to lawyers and team              | ✅     | `/tasks`                                                                                                                                                            |
| WhatsApp / email / app notifications          | 🟡     | In-app notifications ✅. **Email and WhatsApp channels not built** (needs provider credentials: SMTP/SES, WhatsApp Business API/Twilio). Delivery goes through n8n. |
| Daily report of pending/overdue work          | 🟡     | n8n `daily-report` sends counts; no dashboard report page.                                                                                                          |
| Checklist + document prep before next hearing | ❌     | Add a hearing **checklist** (template items → tasks) generated N days before a hearing.                                                                             |

## 4. Client communication assistant

| Requirement                                | Status | Notes                                                                                |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------ |
| Approved answers to common questions       | ❌     | Add an **answer library** (approved by an attorney; versioned).                      |
| Meeting scheduling + appointment reminders | 🟡     | Events + reminders exist; no client-facing booking and no external reminder channel. |
| Ask a client for missing documents         | ❌     | Add **document requests** (portal shows the request; client uploads).                |
| Case-update message drafts                 | ❌     | New AI task `client_update` → draft → attorney approves → sent via channel.          |
| Communication history per client           | ❌     | Add a **communication log** (message, channel, direction, who approved).             |

## 5. Billing & office operations

| Requirement                            | Status | Notes                                                                           |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| Client-wise invoices and payments      | ✅     | `/invoices`                                                                     |
| Reminders for outstanding fees         | ❌     | Add overdue-invoice reminders (in-app now, email/WhatsApp when channels exist). |
| Team workload and productivity reports | 🟡     | Time-by-person report ✅; open-tasks/overdue-per-person ❌.                     |
| Monthly revenue, pending billing       | 🟡     | Summary + aging ✅; no month-by-month revenue chart.                            |
| Onboarding forms, engagement letters   | ❌     | Add **templates** + client onboarding form + e-acceptance in the portal.        |

## Build order (each step ends with tests, lint, typecheck, build, and a check against the live app)

1. **Design system + dashboard shell** (done: sidebar, ⌘K search, clock, dark mode, charts).
2. **Module 1**: court fields, client documents tab, matter/client timeline, AI client summary.
3. **Module 2**: document upload UI, text extraction + OCR in the worker, templates + drafting UI, similar-document search.
4. **Module 5**: reminders for overdue invoices, workload report, monthly revenue, engagement letters/onboarding.
5. **Module 3**: hearing checklists, daily report page, notification channels (email first, then WhatsApp).
6. **Module 4**: answer library, document requests, communication log, AI message drafts.

## Decisions that need the owner

- **Email / WhatsApp provider.** Sending real messages needs an account (SMTP/SES, WhatsApp Business via Meta or Twilio) and, for WhatsApp, approved message templates. Until then messages are drafted and logged, and delivered in-app only.
- **OCR engine.** Self-hosted (Tesseract/OCRmyPDF in the worker, no data leaves the firm) vs a cloud OCR API. Self-hosted is the default here because client documents are confidential.
- **Similar-document search.** Keyword/BM25 in MongoDB now; embeddings later if a vector store is approved.
