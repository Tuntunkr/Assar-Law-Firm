# Local demo, then UAT

This runbook prepares a conversation. It does not record acceptance, a merge, or a deploy.

## Before the owner reviews

1. `bash scripts/local-demo.sh status` shows the API ready, the worker health, and the three web ports.
2. Staff sign-in uses `.data/demo-login.txt` on that computer. The owner and billing need the authenticator. Other staff roles use the password.
3. The portal uses the organization slug, the portal email, and the same password.
4. Walk one synthetic matter from intake through the portal. On this cloud worker that walk was `node scripts/run-journey.mjs` against the API, then the same records in the staff and portal screens. Court fields are typed. A date is a person’s date. A local email stays `held_local` and is not shown in the portal. A mock update is not a WhatsApp send. An invoice is issued in the firm currency and paid by a recorded bank transfer, not a gateway. The portal shows that client’s matter, the paid invoice, and the mock update. It hides the other client, the draft invoice, and the local email. The original journey file stays unscanned and unshared. A later file that ClamAV marked clean is listed, and an EICAR test file is not. The lead attorney and the assigned intern show their names. `node scripts/run-scan-check.mjs` repeats the scan check when clamd is listening.
5. Staff and portal navigation targets are at least 44px. Check a keyboard skip link, a 390px-wide window, and reduced motion. The cloud measurement is in the master PRD, section 4.2. It is not a substitute for the owner’s screen.
6. Public pages name the firm and do not invent a lawyer, an address, a result, a price, or a testimonial. With local booking on, success says the row stayed on this computer.

## Still closed

- No court feed is live. `GET /v1/courts/provider` stays the external activation gate.
- WhatsApp and SMTP do not send.
- n8n is not a production webhook.
- A taxed invoice needs a person to record accountant review. The software does not choose GST.
- A court form marked legally approved is a person’s declaration. `licenseCheck` stays `not_performed`.
- The local demo expects ClamAV on `127.0.0.1:3310`. This worker has it. The owner’s computer does not until the commands in [localhost.md](../localhost.md) are run. A missing daemon fails closed. Production rejects a disabled scanner.

## Not this step

Owner UAT, a pull request, merge, production data, and deploy stay unapproved until a separate explicit yes. The collaborator refusal on the pull request stands. Do not work around it.

Rollback of a future deploy is not rehearsed here. Mongo backup scripts exist under `scripts/`. A script on disk is not a restored backup.
