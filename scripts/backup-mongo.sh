#!/usr/bin/env bash
# Encrypted MongoDB backup.
#
#   MONGODB_URI=... BACKUP_PASSPHRASE=... scripts/backup-mongo.sh [output-dir]
#
# Produces, in output-dir (default ./backups):
#   <db>-<UTC timestamp>.archive.gz.enc   AES-256 encrypted, gzip-compressed mongodump archive
#   <db>-<UTC timestamp>.sha256           checksum of the encrypted file (detects corruption)
#   <db>-<UTC timestamp>.mac              keyed HMAC of the encrypted file (detects tampering; needs the passphrase)
#   <db>-<UTC timestamp>.manifest.json    document counts per collection (used by backup-verify.sh)
#
# The passphrase is read from the environment, never from the command line (which other users can see).
# Store the passphrase separately from the backups, e.g. in your secret manager.
set -euo pipefail
umask 077

: "${MONGODB_URI:?Set MONGODB_URI}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE (min 16 chars)}"
if [ "${#BACKUP_PASSPHRASE}" -lt 16 ]; then echo "BACKUP_PASSPHRASE must be at least 16 characters" >&2; exit 1; fi
for tool in mongodump openssl shasum node; do command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }; done

OUT="${1:-./backups}"
mkdir -p "$OUT"
HERE="$(cd "$(dirname "$0")" && pwd)"

DB="$(node "$HERE/mongo-info.mjs" db)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$OUT/$DB-$STAMP"

# Counts first, so the manifest describes (at least) what the dump should contain.
node "$HERE/mongo-info.mjs" counts > "$BASE.manifest.json"

# Stream: mongodump -> encrypt -> file. No plaintext copy is ever written to disk.
mongodump --uri="$MONGODB_URI" --archive --gzip --quiet \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE \
  > "$BASE.archive.gz.enc"

( cd "$OUT" && shasum -a 256 "$(basename "$BASE").archive.gz.enc" > "$(basename "$BASE").sha256" )
# Keyed MAC: unlike the checksum, this cannot be recomputed by someone who altered the file without the passphrase.
node "$HERE/mongo-info.mjs" mac "$BASE.archive.gz.enc" > "$BASE.mac"
echo "backup written: $BASE.archive.gz.enc ($(wc -c < "$BASE.archive.gz.enc" | tr -d ' ') bytes)"
