# Local synthetic demo

This is the way to run Assar on one computer with invented records. It does not deploy, send email, call a court, or charge a card. A run on a cloud worker is not a run on the owner’s computer. The owner’s computer stays the place that must be tried later.

## What you need

- Node.js 22 or newer
- pnpm 9.x
- MongoDB that can form a one-node replica set
- Redis
- The repo root as the working directory

No production secret is required. `NODE_ENV` stays `development`. Production auth checks are not switched off.

## Ports

| Process | URL |
| --- | --- |
| Marketing | http://127.0.0.1:3000 |
| Staff dashboard | http://127.0.0.1:3001 |
| Client portal | http://127.0.0.1:3002 |
| API | http://127.0.0.1:4000 |
| Worker health | http://127.0.0.1:4100/healthz |
| MongoDB | `mongodb://127.0.0.1:27117/assar_demo?replicaSet=rs0` |
| Redis | `redis://127.0.0.1:6380` |

`GET /healthz` is liveness. `GET /readyz` fails when Mongo or Redis is down. That failure is the ready check working.

Open the dashboard and the portal on `127.0.0.1` when `VITE_API_URL` is `http://127.0.0.1:4000`. A page on `localhost` does not send a cookie that the API set for `127.0.0.1`.

## Start, status, reset, stop

```bash
bash scripts/local-demo.sh start
bash scripts/local-demo.sh status
bash scripts/local-demo.sh reset
bash scripts/local-demo.sh stop
```

`start` brings up Mongo and Redis if they are not already running, builds the API, seeds a synthetic firm once, then restarts the API with registration off. The seed writes `.data/demo-login.txt` and does not print the password. `reset` drops only the `assar_demo` database. `stop` stops the demo apps and leaves Mongo and Redis running. `bash scripts/dev-services.sh stop` stops those two as well.

If ports 3000, 3001, 3002, 4000, or 4100 are taken, `start` exits and names the port. It does not kill another program for you.

## What the seed creates

A firm named Synthetic Preview LLP. An owner and a billing user who need an authenticator code. An attorney, a paralegal, a staff user, and an intern who use the shared password and do not need a code. A synthetic client, a matter with a 16-character CNR `SYNTHETICPREVIEW`, a typed date, a hearing, an unsent email preview, a zero-tax invoice draft, and a portal user. Nothing is a real case.

Court import is on, and it still does not fetch a court. Email delivery is local: an approved email is stored in this database. Demo booking is local: a slot can be saved and is not emailed or calendared. The message provider stays unconfigured. Workflows and AI stay off. Scanning is disabled in this development demo, so a file is not marked clean. Production refuses that setting.

## Payment gateway

There is no payment gateway. Record a payment by hand on an issued invoice. The owner will add a gateway later, with their own API and security.

## After a local pass

Feature checks come first. Owner acceptance is a separate step and is not done by this script. Merge, deploy, and publication are further separate approvals. See [the local UAT gate](runbooks/local-demo-uat.md).
