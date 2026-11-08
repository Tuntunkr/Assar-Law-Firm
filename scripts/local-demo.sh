#!/usr/bin/env bash
# Reproducible synthetic demo. Binds to this computer. Does not deploy, send mail, or call a court.
# Usage: scripts/local-demo.sh start|stop|status|reset
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DATA="$ROOT/.data"
ENV_FILE="$DATA/demo.env"
SESSION="assar-local-demo"
TMUX=(tmux -f /exec-daemon/tmux.portal.conf)
if ! "${TMUX[@]}" -V >/dev/null 2>&1; then
  TMUX=(tmux)
fi

write_env() {
  local registration="$1"
  mkdir -p "$DATA/logs" "$DATA/storage"
  local session mfa
  if [[ -f "$ENV_FILE" ]]; then
    session="$(grep '^SESSION_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
    mfa="$(grep '^MFA_ENCRYPTION_KEY=' "$ENV_FILE" | cut -d= -f2-)"
  else
    session="$(openssl rand -hex 32)"
    mfa="$(openssl rand -hex 32)"
  fi
  cat >"$ENV_FILE" <<EOF
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27117/assar_demo?replicaSet=rs0
REDIS_URL=redis://127.0.0.1:6380
SESSION_SECRET=${session}
MFA_ENCRYPTION_KEY=${mfa}
CORS_ORIGINS=http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002,http://localhost:3000,http://localhost:3001,http://localhost:3002
REGISTRATION_ENABLED=${registration}
AUTH_RATE_LIMIT_PER_MIN=30
PUBLIC_API_URL=http://127.0.0.1:4000
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=${DATA}/storage
SCAN_PROVIDER=disabled
QUEUE_PREFIX=assar-demo
AI_ENABLED=false
WORKFLOWS_ENABLED=false
MESSAGE_PROVIDER=unconfigured
COURT_FEED=import
EMAIL_DELIVERY=local
DEMO_BOOKING=local
ASSAR_API_URL=http://127.0.0.1:4000
VITE_API_URL=http://127.0.0.1:4000
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
WORKER_HEALTH_PORT=4100
WORKER_HEALTH_HOST=127.0.0.1
LOG_LEVEL=info
EOF
  chmod 600 "$ENV_FILE"
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

wait_http() {
  local url="$1"
  local i
  for i in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Not ready: $url" >&2
  return 1
}

window() {
  local name="$1"
  local command="$2"
  if "${TMUX[@]}" has-session -t "=$SESSION" 2>/dev/null; then
    "${TMUX[@]}" new-window -d -t "$SESSION" -n "$name" -c "$ROOT"
  else
    "${TMUX[@]}" new-session -d -s "$SESSION" -n "$name" -c "$ROOT"
  fi
  "${TMUX[@]}" send-keys -t "$SESSION:$name" "$command" C-m
}

drop_demo_db() {
  load_env
  pnpm --filter @assar/database exec node --input-type=module -e '
    import { MongoClient } from "mongodb";
    const uri = process.env.MONGODB_URI ?? "";
    if (!uri.includes("/assar_demo")) {
      console.error("Refusing to drop a database that is not assar_demo.");
      process.exit(1);
    }
    const client = new MongoClient(uri);
    await client.connect();
    await client.db().dropDatabase();
    await client.close();
  '
  rm -f "$DATA/demo-login.txt"
}

start_apps() {
  local with_seed="$1"
  bash "$ROOT/scripts/dev-services.sh" start
  if [[ "$with_seed" == "yes" ]]; then
    write_env true
  else
    write_env false
  fi
  load_env
  pnpm exec turbo run build --filter=@assar/database --filter=@assar/types --filter=@assar/validation --filter=@assar/api-client --filter=@assar/jobs --filter=@assar/storage --filter=@assar/api --output-logs=errors-only
  # Do not exec: the pane must keep its shell so a later restart can run.
  window api "set -a; source .data/demo.env; set +a; pnpm --filter @assar/api start"
  wait_http "http://127.0.0.1:4000/readyz"
  if [[ "$with_seed" == "yes" ]]; then
    node "$ROOT/scripts/seed-demo.mjs"
    write_env false
    "${TMUX[@]}" send-keys -t "$SESSION:api" C-c
    local i
    for i in $(seq 1 30); do
      if ! curl -fsS "http://127.0.0.1:4000/healthz" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    "${TMUX[@]}" send-keys -t "$SESSION:api" "set -a; source .data/demo.env; set +a; pnpm --filter @assar/api start" C-m
    wait_http "http://127.0.0.1:4000/readyz"
  fi
  window worker "set -a; source .data/demo.env; set +a; pnpm --filter @assar/worker dev"
  window dashboard "set -a; source .data/demo.env; set +a; pnpm --filter @assar/dashboard dev --host 127.0.0.1"
  window portal "set -a; source .data/demo.env; set +a; pnpm --filter @assar/client-portal dev --host 127.0.0.1"
  window web "set -a; source .data/demo.env; set +a; pnpm --filter @assar/web dev"
  wait_http "http://127.0.0.1:4100/healthz" || echo "Worker health is still starting. Check: tmux attach -t $SESSION"
  wait_http "http://127.0.0.1:3001" || true
  wait_http "http://127.0.0.1:3002" || true
  wait_http "http://127.0.0.1:3000" || true
  echo "Demo is up. Login material: .data/demo-login.txt"
  echo "Marketing http://127.0.0.1:3000  Staff http://127.0.0.1:3001  Portal http://127.0.0.1:3002  API http://127.0.0.1:4000"
}

port_busy() {
  python3 - "$1" <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(0.2)
code = s.connect_ex(("127.0.0.1", int(sys.argv[1])))
s.close()
raise SystemExit(0 if code == 0 else 1)
PY
}

require_ports_free() {
  local busy=0 port
  for port in 3000 3001 3002 4000 4100; do
    if port_busy "$port"; then
      echo "Port $port is already in use. Stop the old process before starting the demo." >&2
      busy=1
    fi
  done
  if [[ "$busy" -ne 0 ]]; then
    exit 1
  fi
}

case "${1:-}" in
  start)
    if "${TMUX[@]}" has-session -t "=$SESSION" 2>/dev/null; then
      echo "Session $SESSION already exists. Use status, or stop first." >&2
      exit 1
    fi
    require_ports_free
    if [[ -f "$DATA/demo-login.txt" ]]; then
      start_apps no
    else
      start_apps yes
    fi
    ;;
  stop)
    if "${TMUX[@]}" has-session -t "=$SESSION" 2>/dev/null; then
      "${TMUX[@]}" kill-session -t "$SESSION"
    fi
    echo "Stopped the demo apps. Mongo on 27117 and Redis on 6380 are still running."
    echo "Stop those too with: bash scripts/dev-services.sh stop"
    ;;
  reset)
    if "${TMUX[@]}" has-session -t "=$SESSION" 2>/dev/null; then
      "${TMUX[@]}" kill-session -t "$SESSION"
    fi
    bash "$ROOT/scripts/dev-services.sh" start
    write_env true
    drop_demo_db
    start_apps yes
    ;;
  status)
    if "${TMUX[@]}" has-session -t "=$SESSION" 2>/dev/null; then
      "${TMUX[@]}" list-windows -t "$SESSION"
    else
      echo "Demo apps are not running."
    fi
    for url in \
      "http://127.0.0.1:4000/healthz" \
      "http://127.0.0.1:4000/readyz" \
      "http://127.0.0.1:4100/healthz" \
      "http://127.0.0.1:3000" \
      "http://127.0.0.1:3001" \
      "http://127.0.0.1:3002"
    do
      if curl -fsS "$url" >/dev/null 2>&1; then
        echo "ok  $url"
      else
        echo "down  $url"
      fi
    done
    ;;
  *)
    echo "Usage: scripts/local-demo.sh start|stop|status|reset" >&2
    exit 2
    ;;
esac
