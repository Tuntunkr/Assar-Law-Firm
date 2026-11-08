# Local demo, then UAT

This runbook prepares a conversation. It does not record acceptance, a merge, or a deploy.

## Before the owner reviews

1. `bash scripts/local-demo.sh status` shows the API ready, the worker health, and the three web ports.
2. Staff sign-in uses `.data/demo-login.txt` on that computer. The owner and billing need the authenticator. Other staff roles use the password.
3. The portal uses the organization slug, the portal email, and the same password.
4. Walk one synthetic matter: court fields are typed, a date is a person’s date, a message preview is not sent, an invoice is not collected by a gateway, and another client’s matter is absent.
5. Public pages name the firm and do not invent a lawyer, an address, a result, a price, or a testimonial. With local booking on, success says the row stayed on this computer.

## Still closed

- No court feed is live. `GET /v1/courts/provider` stays the external activation gate.
- WhatsApp and SMTP do not send.
- n8n is not a production webhook.
- A taxed invoice needs a person to record accountant review. The software does not choose GST.
- A court form marked legally approved is a person’s declaration. `licenseCheck` stays `not_performed`.
- Scanning is off only in this development demo. Production rejects that.

## Not this step

Owner UAT, a pull request, merge, production data, and deploy stay unapproved until a separate explicit yes. The collaborator refusal on the pull request stands. Do not work around it.

Rollback of a future deploy is not rehearsed here. Mongo backup scripts exist under `scripts/`. A script on disk is not a restored backup.
