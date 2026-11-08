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
MONGODB_URI=mongodb://127.0.0.1:${MONGO_PORT}/assar_demo?replicaSet=rs0
REDIS_URL=redis://127.0.0.1:${REDIS_PORT}
SESSION_SECRET=${session}
MFA_ENCRYPTION_KEY=${mfa}
CORS_ORIGINS=http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002,http://localhost:3000,http://localhost:3001,http://localhost:3002
REGISTRATION_ENABLED=${registration}
AUTH_RATE_LIMIT_PER_MIN=30
PUBLIC_API_URL=http://127.0.0.1:4000
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=${DATA}/storage
SCAN_PROVIDER=clamav
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
QUEUE_PREFIX=assar-demo
AI_ENABLED=false
WORKFLOWS_ENABLED=false
MESSAGE_PROVIDER=mock
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

find_mongod() {
  MONGOD_BIN="$(command -v mongod || true)"
  if [[ -z "$MONGOD_BIN" && -x /tmp/mongodb-linux-x86_64-ubuntu2204-7.0.14/bin/mongod ]]; then
    MONGOD_BIN="/tmp/mongodb-linux-x86_64-ubuntu2204-7.0.14/bin/mongod"
    echo "mongod is not on PATH. Using the binary found at ${MONGOD_BIN}."
  fi
  if [[ -z "$MONGOD_BIN" ]]; then
    echo "mongod is not on PATH and no local binary was found. Install MongoDB 7 and put mongod on PATH." >&2
    exit 1
  fi
}

listener_cmd() {
  python3 - "$1" <<'PY'
import os, sys
port = f"{int(sys.argv[1]):04X}"
inodes = set()
for path in ("/proc/net/tcp", "/proc/net/tcp6"):
    if not os.path.exists(path):
        continue
    for line in open(path):
        parts = line.split()
        if len(parts) < 10 or parts[1].count(":") != 1:
            continue
        if parts[1].split(":")[1].upper() == port and parts[3] in ("0A", "01"):
            inodes.add(parts[9])
found = []
seen = set()
for pid in os.listdir("/proc"):
    if not pid.isdigit():
        continue
    fd = f"/proc/{pid}/fd"
    try:
        names = os.listdir(fd)
    except OSError:
        continue
    for name in names:
        try:
            target = os.readlink(f"{fd}/{name}")
        except OSError:
            continue
        if target.startswith("socket:[") and target[8:-1] in inodes:
            if pid in seen:
                continue
            seen.add(pid)
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\x00", b" ").decode()
            found.append(f"{pid} {cmd}")
print("\n".join(found))
PY
}

listener_cwd() {
  local line pid
  line="$(listener_cmd "$1" || true)"
  [[ -z "$line" ]] && return 0
  pid="${line%% *}"
  readlink "/proc/${pid}/cwd" 2>/dev/null || true
}

ensure_owned_services() {
  find_mongod
  mkdir -p "$DATA/mongo" "$DATA/redis" "$DATA/logs"
  local own_mongo own_redis cmd
  own_mongo="$(cd "$DATA/mongo" && pwd)"
  own_redis="$(cd "$DATA/redis" && pwd)"
  if [[ -f "$DATA/demo-services.env" ]]; then
    # shellcheck disable=SC1090
    source "$DATA/demo-services.env"
    cmd="$(listener_cmd "${MONGO_PORT}" || true)"
    if [[ -n "$cmd" && "$cmd" == *"${MONGO_DBPATH}"* ]]; then
      echo "Reusing the MongoDB recorded for this demo at ${MONGO_DBPATH} on port ${MONGO_PORT}."
      STARTED_MONGO=no
      local redis_cmd redis_cwd redis_bin
      redis_cmd="$(listener_cmd "${REDIS_PORT}" || true)"
      redis_cwd="$(listener_cwd "${REDIS_PORT}" || true)"
      if [[ -n "$redis_cmd" && ( "$redis_cmd" == *"${REDIS_DIR}"* || "$redis_cwd" == "${REDIS_DIR}" ) ]]; then
        echo "Reusing the Redis recorded for this demo at ${REDIS_DIR} on port ${REDIS_PORT}."
        echo "Redis reports its working directory as ${redis_cwd}. Its command line does not keep --dir."
        return 0
      fi
      if [[ -z "$redis_cmd" ]]; then
        redis_bin="$(command -v redis-server || true)"
        if [[ -z "$redis_bin" && -x "$ROOT/.data/redis-src/redis-7.2.5/src/redis-server" ]]; then
          redis_bin="$ROOT/.data/redis-src/redis-7.2.5/src/redis-server"
        fi
        if [[ -z "$redis_bin" ]]; then
          echo "redis-server is not on PATH and the local build was not found." >&2
          exit 1
        fi
        echo "Starting Redis again at ${REDIS_DIR} on port ${REDIS_PORT}."
        "$redis_bin" --port "$REDIS_PORT" --bind 127.0.0.1 --dir "$REDIS_DIR" --daemonize yes --save "" >/dev/null
        return 0
      fi
      echo "The recorded Redis on port ${REDIS_PORT} is not ${REDIS_DIR}. It will be left running."
      return 0
    fi
  fi
  STARTED_MONGO=no
  STARTED_REDIS=no
  cmd="$(listener_cmd 27117 || true)"
  if [[ -z "$cmd" ]]; then
    MONGO_PORT=27117
    MONGO_DBPATH="$own_mongo"
    STARTED_MONGO=yes
  elif grep -F -- "--dbpath ${own_mongo}" <<<"$cmd" >/dev/null || grep -F -- "--dbpath=${own_mongo}" <<<"$cmd" >/dev/null; then
    MONGO_PORT=27117
    MONGO_DBPATH="$own_mongo"
    echo "Reusing the MongoDB this demo already owns at ${MONGO_DBPATH} on port ${MONGO_PORT}."
  else
    echo "Port 27117 is used by a MongoDB this demo does not own. It will be left running."
    echo "$cmd" | sed 's/dbpath/data-directory/'
    MONGO_DBPATH="$(mkdir -p "$DATA/demo-mongo" && cd "$DATA/demo-mongo" && pwd)"
    MONGO_PORT=""
    local candidate
    for candidate in 27119 27120 27121 27122; do
      local candidate_cmd
      candidate_cmd="$(listener_cmd "$candidate" || true)"
      if [[ -z "$candidate_cmd" ]]; then
        MONGO_PORT="$candidate"
        break
      fi
      if [[ "$candidate_cmd" == *"${MONGO_DBPATH}"* ]]; then
        MONGO_PORT="$candidate"
        STARTED_MONGO=no
        echo "Reusing the MongoDB this demo already owns at ${MONGO_DBPATH} on port ${MONGO_PORT}."
        break
      fi
    done
    if [[ -z "$MONGO_PORT" ]]; then
      echo "No free MongoDB port in 27119-27122." >&2
      exit 1
    fi
    STARTED_MONGO=yes
    echo "This demo will use port ${MONGO_PORT} and data directory ${MONGO_DBPATH}."
  fi
  if [[ "$STARTED_MONGO" == "yes" ]]; then
    "$MONGOD_BIN" --dbpath "$MONGO_DBPATH" --port "$MONGO_PORT" --replSet rs0 --bind_ip 127.0.0.1 \
      --fork --logpath "$DATA/mongod-demo.log" >/dev/null
    MONGO_PORT="$MONGO_PORT" node "$ROOT/scripts/init-replset.mjs"
  fi
  local redis_bin redis_cmd
  redis_bin="$(command -v redis-server || true)"
  if [[ -z "$redis_bin" && -x "$ROOT/.data/redis-src/redis-7.2.5/src/redis-server" ]]; then
    redis_bin="$ROOT/.data/redis-src/redis-7.2.5/src/redis-server"
  fi
  redis_cmd="$(listener_cmd 6380 || true)"
  if [[ -z "$redis_cmd" ]]; then
    REDIS_PORT=6380
    REDIS_DIR="$own_redis"
    STARTED_REDIS=yes
  elif grep -F -- "$own_redis" <<<"$redis_cmd" >/dev/null; then
    REDIS_PORT=6380
    REDIS_DIR="$own_redis"
    echo "Reusing the Redis this demo already owns at ${REDIS_DIR} on port ${REDIS_PORT}."
  else
    echo "Port 6380 is used by a Redis this demo does not own. It will be left running."
    REDIS_DIR="$own_redis"
    REDIS_PORT=""
    local rport
    for rport in 6382 6383 6384; do
      local rcmd rcwd
      rcmd="$(listener_cmd "$rport" || true)"
      rcwd="$(listener_cwd "$rport" || true)"
      if [[ -z "$rcmd" ]]; then
        REDIS_PORT="$rport"
        break
      fi
      if [[ "$rcwd" == "$REDIS_DIR" || "$rcmd" == *"${REDIS_DIR}"* ]]; then
        REDIS_PORT="$rport"
        STARTED_REDIS=no
        echo "Reusing the Redis this demo already owns at ${REDIS_DIR} on port ${REDIS_PORT}."
        break
      fi
    done
    if [[ -z "$REDIS_PORT" ]]; then
      echo "No free Redis port in 6382-6384." >&2
      exit 1
    fi
    STARTED_REDIS=yes
    echo "This demo will use Redis port ${REDIS_PORT} and directory ${REDIS_DIR}."
  fi
  if [[ "$STARTED_REDIS" == "yes" ]]; then
    if [[ -z "$redis_bin" ]]; then
      echo "redis-server is not on PATH and the local build was not found." >&2
      exit 1
    fi
    "$redis_bin" --port "$REDIS_PORT" --bind 127.0.0.1 --dir "$REDIS_DIR" --daemonize yes --save "" >/dev/null
  fi
  cat >"$DATA/demo-services.env" <<EOF
MONGO_PORT=${MONGO_PORT}
MONGO_DBPATH=${MONGO_DBPATH}
MONGOD_BIN=${MONGOD_BIN}
STARTED_MONGO=${STARTED_MONGO}
REDIS_PORT=${REDIS_PORT}
REDIS_DIR=${REDIS_DIR}
STARTED_REDIS=${STARTED_REDIS}
EOF
  echo "Owned MongoDB: ${MONGO_DBPATH} on ${MONGO_PORT} (${MONGOD_BIN})"
  echo "Owned Redis: ${REDIS_DIR} on ${REDIS_PORT}"
  echo "App users are separate from MongoDB server authentication. This mongod has no user database and no auth."
}

start_apps() {
  local with_seed="$1"
  ensure_owned_services
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
  echo "MongoDB ${MONGO_DBPATH} port ${MONGO_PORT}. Redis ${REDIS_DIR} port ${REDIS_PORT}."
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
    if [[ -f "$DATA/demo-services.env" ]]; then
      # shellcheck disable=SC1090
      source "$DATA/demo-services.env"
      if [[ "${STARTED_MONGO:-no}" == "yes" && -n "${MONGO_DBPATH:-}" ]]; then
        pkill -f "mongod.*--dbpath ${MONGO_DBPATH}" || true
        echo "Stopped the demo MongoDB at ${MONGO_DBPATH}."
      else
        echo "Left the existing MongoDB running. This demo did not start it."
      fi
      if [[ "${STARTED_REDIS:-no}" == "yes" && -n "${REDIS_DIR:-}" && -n "${REDIS_PORT:-}" ]]; then
        redis_line="$(listener_cmd "${REDIS_PORT}" || true)"
        redis_pid="${redis_line%% *}"
        redis_cwd="$(listener_cwd "${REDIS_PORT}" || true)"
        if [[ -n "$redis_pid" && "$redis_line" == *redis-server* && "$redis_cwd" == "${REDIS_DIR}" ]]; then
          kill "$redis_pid"
          echo "Stopped the demo Redis pid ${redis_pid} at ${REDIS_DIR} on port ${REDIS_PORT}."
        else
          echo "Left Redis on port ${REDIS_PORT} running. Working directory: ${redis_cwd:-none}."
        fi
      fi
    fi
    ;;
  reset)
    if "${TMUX[@]}" has-session -t "=$SESSION" 2>/dev/null; then
      "${TMUX[@]}" kill-session -t "$SESSION"
    fi
    ensure_owned_services
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
