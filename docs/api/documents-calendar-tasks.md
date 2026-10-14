# API: Documents, Calendar, Tasks (v1)

Conventions are in `auth-and-organizations.md`. Everything is organization-scoped. Items that belong to a **restricted matter** follow the matter's access list (`clients-matters-teams.md`): a caller without access gets a **404 with the same message as a missing item** (e.g. "Document not found").

## Documents

### Storage model

- File bytes live in a **private bucket** (S3-compatible: AWS S3, MinIO, ...) or, in development only, on local disk. They are **never stored in MongoDB**; Mongo holds metadata and an object key that is never returned by the API.
- The browser never gets bucket credentials. It receives **short-lived signed URLs**: upload ≤ `UPLOAD_URL_TTL_SECONDS` (default 15 min), download ≤ `DOWNLOAD_URL_TTL_SECONDS` (default 5 min, max 15). A signed URL is a bearer capability for its lifetime, so treat download URLs as secrets and don't log them.
- Uploads are sent with `Content-Type: application/octet-stream` and an exact `Content-Length` that is part of the signature; downloads are forced to `attachment`. Real content types are recorded in metadata only.
- Production requires `STORAGE_DRIVER=s3` and `SCAN_PROVIDER=clamav` (enforced at startup). The bucket must block public access and allow CORS `PUT`/`GET` from the dashboard origin.

### Flow

1. `POST /matters/:matterId/documents` `{title, filename, contentType, sizeBytes}` → `{document, version (status: pending_upload), upload:{url, method, headers, expiresAt}}`. Content type must be in an allowlist; size ≤ `MAX_UPLOAD_BYTES`; filenames are sanitized.
2. Client sends the bytes to `upload.url` with exactly `upload.headers`.
3. `POST /documents/:id/versions/:n/complete` → API checks the object exists and matches the declared size (otherwise deletes it and returns 400), moves the version to `scanning` and hands it to the scan hook. Idempotent.
4. The scanner sets `clean`, `infected` (object deleted from storage) or `scan_failed`.
5. `POST /documents/:id/versions/:n/download-link` → signed GET link. Only `clean` versions are downloadable (409 with the reason otherwise). Every link issued is audited.

- New versions: `POST /documents/:id/versions` (version numbers are allocated atomically). All versions are kept.
- `POST /documents/:id/versions/:n/rescan` retries a `scan_failed` version, or a `scanning` one stuck for > 10 minutes.
- `GET /matters/:matterId/documents`, `GET /documents/:id` (with versions), `PATCH /documents/:id` (rename), `DELETE /documents/:id` (**soft delete**: hidden from the API, bytes and audit trail retained).

### Scanning

Completing an upload moves the version to `scanning` and enqueues a job (`@assar/jobs`); **apps/worker** streams the object to ClamAV (`INSTREAM`) and records the result. Transient failures (e.g. clamd restarting) are retried with exponential backoff and the version stays `scanning`, a real state, until the last attempt, after which it becomes `scan_failed` (retry with `rescan`). A job lost by a crashed worker is recovered by the queue; `rescan` also accepts a version stuck in `scanning` for more than 10 minutes. If Redis is unreachable at completion time the version is rolled back to its previous status and the API returns 503, so nothing is left `scanning` with no job.
`SCAN_PROVIDER=disabled` (development only, set on the **worker**) marks versions `skipped`, which is never reported as clean and is refused in production.

### Permissions

`document:read` (list/get/download link), `document:write` (everything else). Billing has neither.

## Calendar (`/calendar/events`)

- `POST` / `PATCH /:id` / `DELETE /:id` need `calendar:write`; reads need `matter:read`.
- `GET ?from=&to=` is **required**, at most 366 days, half-open `[from, to)`, ordered by start time with a stable cursor. Filters: `kind` (hearing, deadline, meeting, reminder, other), `matterId`.
- Events may link to a matter. Events on restricted matters are excluded from lists for users without access; org-level events (no matter) are visible to every member who can read matters.
- Attendees must be active members and, for restricted matters, able to see the matter.
- **Deadlines are never computed or invented**: every event is `source: "manual"`. Dates the AI extracts appear only as reviewable items in an AI output; they are never created as calendar events automatically.

## Tasks (`/tasks`)

- `POST` / `PATCH` / `DELETE` need `task:write`; reads need `matter:read`.
- `GET ?assigneeId=<id|me>&status=&matterId=&dueBefore=` with cursor pagination. Marking `done` sets `completedAt`; reopening clears it.
- On restricted matters the assignee must be able to see the matter (re-validated when the matter or assignee changes), and a task disappears from lists when its matter becomes hidden from the viewer.

## Known limitations

- No org-wide document search/list (documents are listed per matter) so restricted matters can't leak through a cross-matter query.
- S3 behaviour (actual PUT/GET against a bucket) has not been exercised in this environment: only URL signing is tested. The local driver and the ClamAV client are tested end to end (the latter against a protocol-level fake clamd).
- Abandoned `pending_upload` versions are not cleaned up yet (a scheduled cleanup job is still to do).
