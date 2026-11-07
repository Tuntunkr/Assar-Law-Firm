#!/usr/bin/env bash
# Delete backups older than N days, but ALWAYS keep the newest 3 backups of each database, so a long outage in
# backing up can never prune your only good copies.
#
#   scripts/backup-prune.sh <backup-dir> <days>
set -euo pipefail
DIR="${1:?usage: backup-prune.sh <backup-dir> <days>}"; DAYS="${2:?days}"
case "$DAYS" in ''|*[!0-9]*) echo "days must be a number" >&2; exit 1;; esac
cd "$DIR"
for db in $(ls *.archive.gz.enc 2>/dev/null | sed -E 's/-[0-9]{8}T[0-9]{6}Z\.archive\.gz\.enc$//' | sort -u); do
  # newest first; skip the 3 newest; delete the rest if older than DAYS
  ls -1 "$db"-*.archive.gz.enc | sort -r | tail -n +4 | while read -r f; do
    if [ -n "$(find "$f" -mtime +"$DAYS" -print)" ]; then
      base="${f%.archive.gz.enc}"
      rm -f "$f" "$base.sha256" "$base.mac" "$base.manifest.json"
      echo "pruned $f"
    fi
  done
done
