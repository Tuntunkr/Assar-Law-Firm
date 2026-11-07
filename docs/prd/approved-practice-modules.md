# PRD — approved practice modules

Baseline commit: `a6314727bbffe3908a52b13457bd9e0bf39c6bd0` (`main` at the start of this work).  
Branch: `cursor/approved-practice-modules-d89d`.  
This document is the product requirement for the six modules the owner approved on 7 Nov 2026. It is not a statute, not a Bar Council opinion, and not a tax opinion.

Legal notes used only as labels come from a research pack checked the same day. That pack is not certified current law. Only three original official PDFs were fully read there; amendments were not verified; CPC, the full BCI rules, and High Court practice were not verified; the firm’s state, court, and case type are unknown. This software therefore does not hard-code limitation periods, tax rates, or a claim that any message template is approved.

## Problem

Assar already stores clients, matters, documents, tasks, billing, staff auth, a client portal, and job queues. It does not track a court case in a way a lawyer can check, it does not record a reviewed hearing outcome, it does not keep a lawyer-approved date register, it cannot preview a client update without sending it, its billing currency is easy to misread as a tax decision, and it has no least-privilege intern.

## Users and roles

Existing roles stay: owner, admin, attorney, paralegal, billing, staff.  
New role: **intern**. An intern sees only matters a lawyer has assigned (an access row created when a task on that matter is assigned to them). They can update the status of tasks assigned to them. They cannot see the rest of the firm’s matters, documents, invoices, or client messages. They cannot approve a hearing note, a deadline, or an outbound message.

Lawyer approval means owner or attorney (`hearing:review`, `deadline:approve`, `message:approve`). Admin is not treated as a lawyer for those three actions.

## Module 1 — Court-wise case tracking

Each matter may store court name, case number, judge, courtroom, jurisdiction, filing date, a 16-character CNR, and an https link the firm believes is the official record.

- CNR is a **shape check** only. It does not prove the case exists.
- Source stored on the record is `manual`.
- Freshness is `unverified` until a user with `matter:write` records that they compared the entry with the official source. The verification stores who and when, not a copy of the court record. A verification older than 7 days is shown as stale.
- Editing the court block clears verification.
- **Official feed:** no credential and no documented machine API are available to this deployment. `GET /v1/courts/provider` returns `external_activation_gate`. The software does not call eCourts, does not scrape, and does not invent orders or next dates.
- A courts list groups matters the caller can already see.

## Module 2 — Hearing outcome

A hearing event (kind `hearing`, source still `manual`) can store a result, notes, and an optional next date (`YYYY-MM-DD`).

- Saving an outcome sets review status to `draft` and clears a previous review.
- Only a lawyer can mark it `reviewed`.
- The next date does not create a filing, a limitation, or a message. A separate lawyer action can copy it into a new manual hearing.
- Results are labels the firm chooses (`adjourned`, `heard`, `order_passed`, `reserved`, `dismissed`, `allowed`, `settled`, `not_reached`, `other`). They are not a judgment from a court.

## Module 3 — Deadline and limitation register

A register row is a date a person typed, plus a note of why they typed it, in `Asia/Kolkata` calendar days.

- Kinds: `limitation` or `other_deadline`. The kind is a label. The software does not apply the Limitation Act or any court rule.
- Status flow: `draft` → `pending_approval` → `approved` or `rejected`, then `closed`.
- History records the action, actor, and time. It does not store a model’s reasoning. There is no AI calculation endpoint.
- In-app reminders go to lawyers who can see the matter, on the offsets the firm stored (default 7, 3, and 1 days before, and the due day).
- Escalation is an in-app notice to those lawyers after the configured number of days overdue (default 1).
- Nothing is emailed or sent on WhatsApp from this register.

## Module 4 — Message preview outbox

Staff with `matter:write` may draft an email or WhatsApp **preview** for a client. The draft must record that the person opted in and that the opt-in names the firm. That is a firm record, not a finding that Meta or the law has accepted the text.

- A lawyer approves or rejects.
- `providerTemplateApproval` is always `not_claimed`.
- If `MESSAGE_PROVIDER=mock`, approval marks `mock_delivered` and does not open a network connection. Tests use this.
- Otherwise approval marks `external_activation_gate`. No WhatsApp token, no SMTP credential, and no approved-template id is required or invented. Live delivery is not implemented.
- A signed webhook can acknowledge a **mock** delivery only. It cannot flip a gated message to “sent”. Unsigned calls fail. Replays of the same event id do nothing.

## Module 5 — INR billing, still manual

Currency was already configurable and already included INR. This work states the policy on the settings response:

- tax is applied only when a person enters a rate (default remains 0; no GST rate is inserted);
- payments are recorded by hand;
- nothing is collected automatically;
- the software does not decide GST, reverse charge, or client-money treatment.

## Module 6 — Intern

Covered under roles. Due alerts for the intern’s own open tasks are in-app, deduplicated per task per Kolkata day.

## Existing product to keep

Clients, matters, documents, tasks, billing, auth, portal, and queues stay on the current NestJS, MongoDB, Redis, and Vite layout. n8n workflow files remain import templates. A webhook base URL on `example.com` is not an active delivery target. `WORKFLOWS_ENABLED` still defaults to false.

## Out of scope

Production deploy, production data, real WhatsApp or email, court filing, payments, a multi-product platform, invented lawyers, offices, win rates, testimonials, and any claim of BCI or tax compliance.

## Acceptance criteria

1. A matter stores CNR and an https link; a bad CNR or a non-https link is rejected; provider status is the external gate; manual verify records actor and time and goes stale after 7 days; a court edit clears it.
2. A hearing outcome saved by a paralegal stays `draft`; an attorney can mark it reviewed; a non-hearing event cannot take an outcome; scheduling the next date creates a manual hearing only when a lawyer asks.
3. A deadline cannot be approved by an intern or a paralegal; an attorney can; the row stores the typed date and note; reminders and escalation are in-app and use Asia/Kolkata dates; no route asks a model to compute a period.
4. An outbox item without opt-in cannot be submitted; a lawyer approval with `MESSAGE_PROVIDER=mock` becomes `mock_delivered` without a network call; with the provider unset it becomes `external_activation_gate`; the webhook rejects a bad signature and ignores a replay.
5. Billing settings can be saved as INR; the settings body says tax is explicit-only and collection is manual; creating an invoice does not invent a tax rate.
6. An intern’s matter list is empty until a task on that matter is assigned to them; another matter returns 404; they cannot read a task that is not assigned to them; the assignment is audited.
7. Worker configuration rejects an n8n base URL whose host is `example.com`.
8. The public homepage names Assar Law Firm, does not invent a lawyer, address, practice, testimonial, or result, and labels screenshots as synthetic. The long publication-review note lives in this document. The public page keeps a short footer notice and does not claim compliance. When no demo inbox is configured, the form is not shown.
9. Lint, typecheck, unit and integration tests, and the production build are run and their results recorded. Browser checks cover the landing page at 1440 and 390, including reduced motion and a numeric contrast check.

## Publication review (owner-facing, not the public hero)

Publishing the marketing site is subject to review by an advocate. A research note dated 7 Nov 2026 described Bar Council of India Rule 36 as restricting advertising and solicitation. That note is not a certified copy of the rules. Only three original official PDFs were fully read in the research pack; amendments were not verified. This page does not offer a result, a win rate, or a comparison that claims another product fails. The software does not claim compliance with that rule. The public footer says only that publication as an advertisement needs advocate review and that the page does not offer a legal result.

## Fulfilment against the approved request

| Area           | In this branch                                                                                                        | External activation, not complete                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Court record   | Manual court fields, CNR shape check, https link, manual verification, stale after 7 days                             | No eCourts, NJDG, or other court feed. `GET /v1/courts/provider` stays `external_activation_gate`                                                                                                                                                                 |
| Hearing review | Outcome, note, next date, lawyer review, schedule-next as a manual hearing                                            | The next instant is a chosen 10:00 IST time, not a time from a court                                                                                                                                                                                              |
| Typed dates    | Draft, lawyer approval, Asia/Kolkata reminders inside the firm                                                        | No statutory calculation                                                                                                                                                                                                                                          |
| Messages       | Preview, consent, opt-out, mock delivery, signed mock webhook, WhatsApp Cloud API adapter                             | Live send needs the firm’s Meta app, system-user token, `whatsapp_business_messaging`, phone number id, app secret, verify token, a template Meta has approved, and a public HTTPS webhook. Default is off. This software does not claim the template is approved |
| INR invoices   | Currency INR, explicit tax only, manual payment, portal view of issued and paid invoices                              | No GST rate, no card collection, no payment gateway                                                                                                                                                                                                               |
| Intern         | Assigned-matter access, own task status, other matters hidden                                                         | None                                                                                                                                                                                                                                                              |
| Client portal  | Documents, reviewed AI text, invoices, released messages, other clients 404                                           | A client does not see drafts                                                                                                                                                                                                                                      |
| n8n            | Workflow files remain templates. Worker rejects an `example.com` webhook host. A disposable local n8n 1.123.92, not a project dependency, ran the committed workflows: 6 tests passed | `WORKFLOWS_ENABLED` still defaults to false. No production webhook is connected                                                                                                                   |
| Landing        | Name only, real screenshots labelled synthetic, services, solutions, and pricing pages, demo hidden when unconfigured | An advocate has not signed the publication                                                                                                                                                                                                                        |

## WhatsApp keys the firm must supply

Do not invent these. Live activation is not done in this branch.

- Meta app, owned by the firm
- System-user access token with `whatsapp_business_messaging`
- Phone number id
- App secret for `X-Hub-Signature-256`
- Verify token for the subscription handshake
- Template name and language that Meta has already approved for that account (this software will not ask Meta whether it is approved)
- HTTPS endpoint for the webhook, which this development environment does not publish

The send URL is `https://graph.facebook.com/v27.0/{PHONE_NUMBER_ID}/messages`, the version in Meta’s send-messages curl on the page updated 4 Nov 2026. `WHATSAPP_GRAPH_VERSION` overrides it. A template-creation example on an older page uses v23.0 and is not the default.

## OCR fixture

On 7 Nov 2026 the jobs test “upscales small images” failed. The image was 700px wide and the engine widened it to 1600, which is the intended behaviour. The host’s generic `sans-serif` face was read as “Rent 1s 5000 per month” at confidence 93. The same pixels in Liberation Sans Bold or DejaVu Sans Bold read as “Rent is 5000 per month”. The test now registers one of those font files, still requires the phrase `rent is 5000`, and still requires the prepared width to be greater than 700. It does not accept “1s”.
