#!/usr/bin/env bash
# Local dev services: MongoDB replica set on 27117 (transactions need a replica set) and, if installed, Redis on 6380.
# Data lives in ./.data (git-ignored). Usage: scripts/dev-services.sh [start|stop]
set -euo pipefail
cd "$(dirname "$0")/.."
OWN_MONGO="$(cd .data/mongo 2>/dev/null && pwd || true)"
case "${1:-start}" in
  start)
    mkdir -p .data/mongo .data/redis
    OWN_MONGO="$(cd .data/mongo && pwd)"
    holders="$(pgrep -af "mongod.*--port 27117" | grep -v "pgrep" || true)"
    if [[ -n "$holders" ]]; then
      if ! grep -F -- "--dbpath ${OWN_MONGO}" <<<"$holders" >/dev/null \
        && ! grep -F -- "--dbpath=${OWN_MONGO}" <<<"$holders" >/dev/null; then
        echo "Port 27117 is already used by a MongoDB whose data directory is not ${OWN_MONGO}." >&2
        echo "This script will not adopt or stop that process. Use scripts/local-demo.sh, which starts its own directory on a free port." >&2
        echo "$holders" | sed 's/--dbpath/data-directory/' >&2
        exit 1
      fi
    else
      mongod --dbpath "${OWN_MONGO}" --port 27117 --replSet rs0 --bind_ip 127.0.0.1 \
        --fork --logpath .data/mongod.log >/dev/null
    fi
    # Prefer a system Redis; otherwise use the one built by scripts/build-redis.sh.
    REDIS_BIN="$(command -v redis-server || true)"
    if [ -z "$REDIS_BIN" ] && [ -x .data/redis-src/redis-7.2.5/src/redis-server ]; then
      REDIS_BIN=.data/redis-src/redis-7.2.5/src/redis-server
    fi
    redis_holders="$(pgrep -af "redis-server.*6380" | grep -v pgrep || true)"
    if [[ -n "$redis_holders" ]] && ! grep -F -- "$(pwd)/.data/redis" <<<"$redis_holders" >/dev/null; then
      echo "Port 6380 is already used by a Redis whose directory is not $(pwd)/.data/redis. It was left running." >&2
      echo "$redis_holders" >&2
      exit 1
    fi
    if [ -n "$REDIS_BIN" ] && [[ -z "$redis_holders" ]]; then
      "$REDIS_BIN" --port 6380 --bind 127.0.0.1 --dir .data/redis --daemonize yes --save "" >/dev/null
    fi
    node scripts/init-replset.mjs
    echo "mongo: mongodb://127.0.0.1:27117/assar?replicaSet=rs0  redis: redis://127.0.0.1:6380"
    ;;
  stop)
    OWN_MONGO="$(cd .data/mongo && pwd)"
    # Stop only the server this script owns. A MongoDB on 27117 with another directory stays up.
    if pgrep -af "mongod.*--port 27117" | grep -v pgrep | grep -F -- "${OWN_MONGO}" >/dev/null; then
      pkill -f "mongod.*--dbpath ${OWN_MONGO}" || true
    else
      echo "No MongoDB for ${OWN_MONGO} is running. Nothing was stopped."
    fi
    if pgrep -af "redis-server.*6380" | grep -F -- "$(pwd)/.data/redis" >/dev/null; then
      pkill -f "redis-server.*--dir $(pwd)/.data/redis" || true
    fi
    ;;
esac
