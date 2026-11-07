#!/usr/bin/env bash
# Restore an encrypted backup made by backup-mongo.sh.
#
#   BACKUP_PASSPHRASE=... scripts/restore-mongo.sh <backup.archive.gz.enc> \
#       --target-uri <mongodb uri> --confirm-db <database name> [--source-db <name>] [--drop]
#
# Safety rails (a restore can destroy data, so it is deliberately hard to do by accident):
#  * the checksum and the keyed MAC are verified first (wrong passphrase or altered file => refused);
#  * you must repeat the target database name with --confirm-db;
#  * a target database that already has data is refused unless you pass --drop.
set -euo pipefail
umask 077

FILE="${1:-}"; shift || true
TARGET_URI=""; CONFIRM=""; SOURCE_DB=""; DROP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target-uri) TARGET_URI="$2"; shift 2 ;;
    --confirm-db) CONFIRM="$2"; shift 2 ;;
    --source-db) SOURCE_DB="$2"; shift 2 ;;
    --drop) DROP="--drop"; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
[ -f "$FILE" ] || { echo "backup file not found: $FILE" >&2; exit 1; }
[ -n "$TARGET_URI" ] || { echo "--target-uri is required" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

TARGET_DB="$(MONGODB_URI="$TARGET_URI" node "$HERE/mongo-info.mjs" db)"
if [ "$CONFIRM" != "$TARGET_DB" ]; then
  echo "refusing: --confirm-db must equal the target database name ('$TARGET_DB')" >&2; exit 1
fi

# 1. Integrity and authenticity - checked BEFORE anything is decrypted or restored.
SUM="${FILE%.archive.gz.enc}.sha256"
if [ -f "$SUM" ]; then
  ( cd "$(dirname "$FILE")" && shasum -a 256 -c "$(basename "$SUM")" >/dev/null 2>&1 ) \
    || { echo "checksum mismatch: the backup is corrupt or has been altered" >&2; exit 1; }
fi
MAC="${FILE%.archive.gz.enc}.mac"
[ -f "$MAC" ] || { echo "refusing: no .mac file next to the backup, so its authenticity cannot be verified" >&2; exit 1; }
[ "$(node "$HERE/mongo-info.mjs" mac "$FILE")" = "$(tr -d '[:space:]' < "$MAC")" ] \
  || { echo "authentication failed: wrong BACKUP_PASSPHRASE, or the backup was modified" >&2; exit 1; }

# 2. Do not overwrite existing data by accident
EXISTING="$(MONGODB_URI="$TARGET_URI" node "$HERE/mongo-info.mjs" total)"
if [ "$EXISTING" -gt 0 ] && [ -z "$DROP" ]; then
  echo "refusing: '$TARGET_DB' already contains $EXISTING documents. Use --drop to replace it." >&2; exit 1
fi

# 3. Decrypt and restore (streamed, nothing plaintext on disk). The archive's database name is remapped to the target.
SRC="${SOURCE_DB:-$(basename "$FILE" | sed -E 's/-[0-9]{8}T[0-9]{6}Z\.archive\.gz\.enc$//')}"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE < "$FILE" \
  | mongorestore --uri="$TARGET_URI" --archive --gzip --quiet $DROP --nsInclude="$SRC.*" --nsFrom="$SRC.*" --nsTo="$TARGET_DB.*"
echo "restored into '$TARGET_DB'"
