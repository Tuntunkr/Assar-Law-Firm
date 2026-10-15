# n8n workflows

Version-controlled [n8n](https://n8n.io) workflows for Assar Law Firm. They automate coordination (reminders, onboarding tasks, daily summaries) **without bypassing the platform's security**: they talk to the API only through `/v1/automation/*`, with a scoped service token, and never see more than the API chooses to show them.

| File                        | Trigger                     | What it does                                                                                        | Token scopes                            |
| --------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `matter-onboarding.json`    | event `matter.created`      | Creates a 4-step onboarding checklist, assigned to the lead attorney (or whoever opened the matter) | `matters:read`, `tasks:write`           |
| `document-review-task.json` | event `document.scan_clean` | Creates a "review this document" task for the lead attorney or uploader                             | `matters:read`, `tasks:write`           |
| `ai-draft-ready.json`       | event `ai.output_ready`     | Notifies the requester that an AI draft awaits (lawyer) review                                      | `notifications:write`                   |
| `deadline-reminders.json`   | hourly                      | Sends in-app reminders for tasks and events due within 24 h, once per item/person/day               | `reminders:read`, `notifications:write` |
| `daily-report.json`         | daily 07:30                 | Sends owners/admins a counts-only summary (restricted matters excluded)                             | `reports:read`, `notifications:write`   |

## How the security works

- **Inbound events** (API → n8n) carry ids only, never document text or personal data. n8n's Webhook node requires the shared secret (Header Auth credential); deliveries are also HMAC-signed (`X-Assar-Signature: sha256=HMAC(secret, "<X-Assar-Timestamp>.<body>")`) if you want to verify them in a Code node.
- **Outbound calls** (n8n → API) use one HTTP Header Auth credential holding `Authorization: Bearer ast_…`. That token works **only** on the endpoints its scopes allow; it is rejected everywhere else (staff, portal, AI, admin) and every use is audited with the token as the actor.
- **Restricted matters:** a token is not a user. The API only gives a workflow item details together with a recipient who may see them, only assigns work on a restricted matter to people with access, and leaves restricted matters out of reports.
- Every write is idempotent (`Idempotency-Key` for tasks, `dedupeKey` for notifications), so retries and redeliveries never duplicate anything.

## Set up

1. **Create the service token** (owner/admin, MFA required): `POST /v1/service-tokens` with `{"name":"n8n","scopes":["matters:read","tasks:write","notifications:write","reminders:read","reports:read"]}`. Copy the `token` from the response; it is shown once. Use a narrower token per workflow if you prefer.
2. **Create two credentials in n8n** (type _Header Auth_):
   - `Assar automation token`: name `Authorization`, value `Bearer ast_…`
   - `Assar webhook token`: name `X-Assar-Webhook-Token`, value = the worker's `N8N_WEBHOOK_SECRET`
3. **Import** each file (`n8n import:workflow --input=workflows/<file>.json` or _Import from file_), open the **Config** node and set `apiUrl` to your API base URL (ending in `/v1`), pick the two credentials on the nodes, and activate.
4. **Point the platform at n8n:**
   - API: `WORKFLOWS_ENABLED=true`
   - Worker: `N8N_WEBHOOK_BASE_URL=https://<your-n8n>/webhook/assar` and `N8N_WEBHOOK_SECRET=…`

   Events are delivered to `<base>/<event-with-dashes>` (`matter-created`, `document-scan-clean`, `ai-output-ready`) with retries. A workflow that isn't active (or n8n still starting) answers 404; the worker retries with backoff, so activate the workflow within a few minutes or the event is dropped.

## Tests

`pnpm --filter @assar/workflows test` checks every file: only core n8n nodes, an acyclic connected graph, credentials for all auth with no embedded secrets, only whitelisted `/automation` endpoints through the configurable URL, idempotency on every write, and it **runs each Code node** and validates the requests it would send against the API's real request schemas.

### Tested against a real n8n

`apps/api/test/n8n.e2e.test.ts` imports these exact files into a throw-away **n8n 1.123.85**, activates them, and drives them with real events from the worker against the real API. It is skipped unless you point it at an n8n install:

```bash
N8N_BIN=/path/to/node_modules/.bin/n8n pnpm --filter @assar/api test -- n8n.e2e   # ~6 minutes
```

It checks that unauthenticated deliveries are rejected, the onboarding checklist and review tasks are created for the right person (and are not duplicated when an event is replayed), restricted-matter work never reaches someone without access, the AI-draft notification links to the draft, and reminders/daily summaries are sent only once however often the schedule fires (the test shortens only the schedule interval to a few seconds).

Caveats of that run: it used n8n's `legacy` expression engine and no task runners, because this machine could not build n8n's native `isolated-vm` module; production n8n should use its defaults. It has not been run on n8n 2.x, with n8n queue mode, or against the hosted n8n Cloud.
