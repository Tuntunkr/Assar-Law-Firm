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
    if command -v redis-server >/dev/null && ! pgrep -f "redis-server.*6380" >/dev/null; then
      redis-server --port 6380 --bind 127.0.0.1 --dir .data/redis --daemonize yes >/dev/null
    fi
    node scripts/init-replset.mjs
    echo "mongo: mongodb://127.0.0.1:27117/assar?replicaSet=rs0"
    ;;
  stop)
    pkill -f "mongod.*--port 27117" || true
    pkill -f "redis-server.*6380" || true
    ;;
esac
