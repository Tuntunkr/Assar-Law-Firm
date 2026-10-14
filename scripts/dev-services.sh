#!/usr/bin/env bash
# Local dev services: MongoDB replica set on 27117 (transactions need a replica set) and, if installed, Redis on 6380.
# Data lives in ./.data (git-ignored). Usage: scripts/dev-services.sh [start|stop]
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-start}" in
  start)
    mkdir -p .data/mongo .data/redis
    if ! pgrep -f "mongod.*--port 27117" >/dev/null; then
      mongod --dbpath .data/mongo --port 27117 --replSet rs0 --bind_ip 127.0.0.1 \
        --fork --logpath .data/mongod.log >/dev/null
    fi
    # Prefer a system Redis; otherwise use the one built by scripts/build-redis.sh.
    REDIS_BIN="$(command -v redis-server || true)"
    if [ -z "$REDIS_BIN" ] && [ -x .data/redis-src/redis-7.2.5/src/redis-server ]; then
      REDIS_BIN=.data/redis-src/redis-7.2.5/src/redis-server
    fi
    if [ -n "$REDIS_BIN" ] && ! pgrep -f "redis-server.*6380" >/dev/null; then
      "$REDIS_BIN" --port 6380 --bind 127.0.0.1 --dir .data/redis --daemonize yes --save "" >/dev/null
    fi
    node scripts/init-replset.mjs
    echo "mongo: mongodb://127.0.0.1:27117/assar?replicaSet=rs0  redis: redis://127.0.0.1:6380"
    ;;
  stop)
    pkill -f "mongod.*--port 27117" || true
    pkill -f "redis-server.*6380" || true
    ;;
esac
