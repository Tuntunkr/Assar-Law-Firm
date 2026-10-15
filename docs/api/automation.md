# Workflow automation API (v1)

For n8n (see `services/workflows`). A **service token** (`ast_…`) is not a user: it has no role and sees nothing "as" anyone. It can call only the endpoints below, only with the matching scope, only inside its own organization, and every use is audited (`actorType: "service"`).

## Tokens (`workflow:manage`: owner, admin)

`POST /service-tokens {name, scopes[], expiresInDays?}` (secret shown once; only a hash is stored) · `GET /service-tokens` · `GET /service-tokens/scopes` · `DELETE /service-tokens/:id` (revokes at once).
Auth failures (unknown, revoked, expired, wrong scope, malformed header) all return the same `401`.

## Endpoints (`Authorization: Bearer ast_…`)

| Endpoint                                       | Scope                 | Notes                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /automation/reminders/due?windowHours=24` | `reminders:read`      | Open tasks (due up to 24 h ago → window) and scheduled events (now → window), **one row per entitled recipient** with a stable `dedupeKey`. Recipients must be active members and able to see the item's matter _now_. Unassigned tasks and attendee-less events are skipped. |
| `POST /automation/notifications`               | `notifications:write` | `{recipientUserId, title, body?, link?, dedupeKey}` → in-app notification for a member. Idempotent on `dedupeKey`. A link to something the recipient can't open is refused (404).                                                                                             |
| `POST /automation/tasks`                       | `tasks:write`         | `Idempotency-Key` **required**. Creates a task marked `createdVia: "workflow"`. On a restricted matter an assignee with access is mandatory.                                                                                                                                  |
| `GET /automation/matters/:id/context`          | `matters:read`        | Ids for deciding whom to assign. Restricted matters return no title or number.                                                                                                                                                                                                |
| `GET /automation/reports/daily`                | `reports:read`        | Counts only plus owner/admin recipient ids. Restricted matters (and items on them) are excluded.                                                                                                                                                                              |

A token cannot call any other endpoint (staff, portal, AI, admin): they are all `401`.

## Outbound events (worker → n8n)

`matter.created`, `document.scan_clean`, `ai.output_ready`, published to a queue by the API/worker and delivered by the worker to `<N8N_WEBHOOK_BASE_URL>/<event-with-dashes>`. Body: `{id, event, organizationId, occurredAt, data}` with **ids only**. Headers: `X-Assar-Webhook-Token` (shared secret), `X-Assar-Event`, `X-Assar-Timestamp`, `X-Assar-Signature: sha256=HMAC(secret, "<timestamp>.<raw body>")`. Network errors, 404 (n8n still starting, or the workflow not active yet), 408, 429 and 5xx are retried (5 attempts, exponential backoff); other 4xx are final. Publishing never fails the action that caused it.

## Staff notifications

`GET /notifications?unread=&limit=&cursor=` (own only, with `unread` count) · `POST /notifications/:id/read` · `POST /notifications/read-all`.

## Limits

Per-token rate limiting is not implemented (only the global per-IP limit). In-app notifications only; e-mail/SMS are left to n8n nodes you add yourself. The workflows are validated structurally, by running their code against the API's request schemas, and end to end in a real n8n 1.123 (opt-in test; see `services/workflows/README.md` for the command and its caveats).
