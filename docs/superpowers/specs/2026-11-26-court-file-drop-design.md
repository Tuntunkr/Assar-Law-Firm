# Court feed — professional file-drop design

## Decision

Live scrape / fake eCourts is out of scope. The professional completion is an **authorised file-drop import** plus **human apply to a matter**.

## Behaviour

1. `COURT_FEED=manual` — typed court card only (default).
2. `COURT_FEED=import` — staff may POST rows the firm already obtained; server never fetches a court.
3. `GET /v1/courts/provider` stays `external_activation_gate` (no live network provider).
4. `POST /v1/courts/imports/:id/apply` with `{ matterId }` copies name, case number, and official URL onto the matter with `trackingSource: 'import'`, freshness `unverified`. Stale rows cannot apply. Lawyer still uses verify for a manual comparison record.
5. Import DTO reports real `appliedToMatter` / matter id when applied.

## Non-goals

Scraping, captcha bypass, auto CNR lookup, auto hearing dates, claiming a live feed without credentials.
