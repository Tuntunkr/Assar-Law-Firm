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
| MongoDB | `127.0.0.1:27117` and `./.data/mongo` when that port is free, or already serving that directory. If another MongoDB owns 27117, it is left running and this demo uses `./.data/demo-mongo` on the first free port from 27119 to 27122 |
| Redis | `127.0.0.1:6380` and `./.data/redis` when that port is free, or the process working directory is already `./.data/redis`. Otherwise the first free port from 6382 to 6384, same directory |

`GET /healthz` is liveness. `GET /readyz` fails when Mongo or Redis is down. The body is `{"status":"not_ready","checks":{"mongodb":"...","redis":"..."}}`. That failure is the ready check working.

The script writes the chosen ports to `.data/demo-services.env`. Read that file before assuming 27117 or 6380. `mongod` has to be on `PATH`. If it is not, the script prints the binary it found, and it exits if it finds none. Redis may drop `--dir` from its command line. The script treats the process working directory as the owned path.

Application users and MongoDB server users are different. Demo passwords are argon2id. This demo mongod is started with no `--auth` and no user database. Argon2 does not harden the database server.

Open the dashboard and the portal on `127.0.0.1` when `VITE_API_URL` is `http://127.0.0.1:4000`. A page on `localhost` does not send a cookie that the API set for `127.0.0.1`.

## Start, status, reset, stop

```bash
bash scripts/local-demo.sh start
bash scripts/local-demo.sh status
bash scripts/local-demo.sh reset
bash scripts/local-demo.sh stop
```

`start` builds the API, seeds a synthetic firm once, then restarts the API with registration off. A later `start`, when `.data/demo-login.txt` is already present, does not seed again. The seed writes `.data/demo-login.txt` and does not print the password. `reset` drops only the `assar_demo` database on the URI in `.data/demo.env`. `stop` stops the demo apps and stops a MongoDB or Redis only when `.data/demo-services.env` says this demo started it and the process still points at the recorded directory. Another machine’s database is not stopped.

If ports 3000, 3001, 3002, 4000, or 4100 are taken, `start` exits and names the port. It does not kill another program for you.

## What the seed creates

A firm named Synthetic Preview LLP. An owner and a billing user who need an authenticator code. An attorney, a paralegal, a staff user, and an intern who use the shared password and do not need a code. A synthetic client, a matter with a 16-character CNR `SYNTHETICPREVIEW`, a typed date, a hearing, an unsent email preview, a zero-tax invoice draft, and a portal user. Nothing is a real case.

Court import is on, and it still does not fetch a court. Email delivery is local: an approved email is stored in this database and is not a portal release. Demo booking is local: a slot can be saved and is not emailed or calendared. The message provider in this demo is `mock`, so an approved WhatsApp-channel preview is marked `mock_delivered` and no socket is opened. It is not Meta. Workflows and AI stay off.

`start` writes `SCAN_PROVIDER=clamav` with `CLAMAV_HOST=127.0.0.1` and `CLAMAV_PORT=3310`. A file can be shared with the portal only after ClamAV marks that version clean. If nothing is listening on that port, the version fails closed and is not marked clean. This cloud worker has ClamAV 1.5.4, started by hand because `policy-rc.d` denied systemd. The owner’s computer needs the same daemon before a portal share will succeed:

```bash
sudo freshclam
# append to /etc/clamav/clamd.conf: TCPSocket 3310 and TCPAddr 127.0.0.1
sudo mkdir -p /var/run/clamav && sudo chown clamav:clamav /var/run/clamav
sudo -u clamav clamd --config-file=/etc/clamav/clamd.conf
```

A hand-started daemon does not come back after reboot. Production still refuses `SCAN_PROVIDER=disabled`.

## Payment gateway

There is no payment gateway. Record a payment by hand on an issued invoice. The owner will add a gateway later, with their own API and security.

## After a local pass

Feature checks come first. Owner acceptance is a separate step and is not done by this script. Merge, deploy, and publication are further separate approvals. See [the local UAT gate](runbooks/local-demo-uat.md).
