# Runbook: background worker (`apps/worker`)

## What it does

Consumes two BullMQ queues from Redis: `scan` (virus-scan uploaded files) and `ai` (Grok jobs). The API never runs jobs itself.

## Configuration

See `.env.example` ("Worker"). Required: `MONGODB_URI`, `REDIS_URL`, storage settings identical to the API's (`STORAGE_DRIVER` and S3 settings, or for local dev `SESSION_SECRET` + `STORAGE_LOCAL_DIR` + `PUBLIC_API_URL`), `QUEUE_PREFIX` identical to the API's.

- Scanning: `SCAN_PROVIDER=clamav` with `CLAMAV_HOST/PORT`. `disabled` is development-only and refused in production.
- AI: set `GROK_API_KEY` **and** `GROK_MODEL` (no default model). Without a key the worker still scans files, and AI jobs are not processed, so also keep `AI_ENABLED=false` on the API.
- Startup fails fast with a list of invalid settings (values are never printed).

## Run

`pnpm --filter @assar/worker build && pnpm --filter @assar/worker start` (dev: `pnpm --filter @assar/worker dev`). Run 2+ replicas for availability; jobs are distributed and a crashed worker's jobs are re-delivered.

## Health and monitoring

- Worker: `GET :4100/healthz` (alive), `/readyz` (MongoDB + Redis reachable, 503 otherwise), `/status` (processed/failed counters, queue depth). Bind with `WORKER_HEALTH_HOST`.
- API: `GET /readyz` includes Redis; `GET /v1/system/workers` (owner/admin) lists live worker heartbeats (expire ~20 s after a worker dies) and queue depth.
- Alert on: no heartbeats while jobs are `waiting`; growing `failed` counts; AI jobs failing with `AI_AUTH_FAILED` (bad/expired key) or `AI_RATE_LIMITED`.

## Common situations

| Symptom                            | Likely cause / action                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uploads stay `scanning`            | No worker running, or ClamAV unreachable (retries then `scan_failed`). Start a worker; after fixing ClamAV call `POST /documents/:id/versions/:n/rescan`.                                                              |
| Versions `scan_failed`             | ClamAV down for all retries. Fix, then `rescan`.                                                                                                                                                                       |
| AI jobs stay `queued`              | No worker with Grok configured. Check `/status` → `aiEnabled`.                                                                                                                                                         |
| AI jobs fail `AI_AUTH_FAILED`      | `GROK_API_KEY` invalid/revoked. Rotate the key in the worker's environment and restart; users can retry failed jobs.                                                                                                   |
| Job `failed` with `WORKER_STALLED` | Worker crashed repeatedly mid-job. Check logs/OOM; retry the job.                                                                                                                                                      |
| Redis outage                       | API returns 503 for new uploads-complete/AI requests (nothing is left half-queued). Existing state is in MongoDB. Jobs already in Redis are lost only if Redis loses its data: enable persistence (AOF) in production. |

## Deploy / rollback

Workers are stateless. To deploy: start new workers, then send SIGTERM to the old ones; they stop taking jobs and finish running ones (up to 30 s) before exiting. Roll back by redeploying the previous image; job payloads are small ids and stay compatible across versions (add fields, don't rename).

## Security notes

The worker holds the only copy of the Grok key. Never log prompts or responses (the code does not). Run it in a private network; its health port is unauthenticated.
