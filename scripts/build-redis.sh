#!/usr/bin/env bash
# Builds Redis 7.2.5 from the official source tarball into ./.data/redis-src (no Homebrew or Docker needed).
# The tarball's SHA-256 is checked against the hash Redis publishes in github.com/redis/redis-hashes.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=7.2.5
SHA256=5981179706f8391f03be91d951acafaeda91af7fac56beffb2701963103e423d
DIR=.data/redis-src
mkdir -p "$DIR"
curl -fsSL -o "$DIR/redis.tar.gz" "https://download.redis.io/releases/redis-$VERSION.tar.gz"
echo "$SHA256  $DIR/redis.tar.gz" | shasum -a 256 -c -
tar xzf "$DIR/redis.tar.gz" -C "$DIR"
make -C "$DIR/redis-$VERSION" -j4 BUILD_TLS=no MALLOC=libc
echo "built: $DIR/redis-$VERSION/src/redis-server"
