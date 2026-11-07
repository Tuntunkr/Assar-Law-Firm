#!/usr/bin/env bash
# Restore drill: proves a backup can actually be restored and matches its manifest.
#
#   MONGODB_URI=<server to restore on> BACKUP_PASSPHRASE=... scripts/backup-verify.sh <backup.archive.gz.enc>
#
# Restores into a throw-away database on the same server, compares every collection's document count with the
# manifest written at backup time, then drops the throw-away database. Exit code 0 only if everything matches.
# Run it on a schedule (e.g. weekly) against your newest backup: an untested backup is only a hope.
set -euo pipefail
FILE="${1:?usage: backup-verify.sh <backup.archive.gz.enc>}"
: "${MONGODB_URI:?Set MONGODB_URI (the server to restore on; a temporary database is created and dropped)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="${FILE%.archive.gz.enc}.manifest.json"
[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 1; }

TMP_DB="restore_verify_$(date +%s)_$RANDOM"
TMP_URI="$(MONGODB_URI="$MONGODB_URI" node "$HERE/mongo-info.mjs" with-db "$TMP_DB")"
cleanup() { MONGODB_URI="$TMP_URI" node "$HERE/mongo-info.mjs" drop >/dev/null 2>&1 || true; }
trap cleanup EXIT

"$HERE/restore-mongo.sh" "$FILE" --target-uri "$TMP_URI" --confirm-db "$TMP_DB" >/dev/null
MONGODB_URI="$TMP_URI" node "$HERE/mongo-info.mjs" compare "$MANIFEST"
