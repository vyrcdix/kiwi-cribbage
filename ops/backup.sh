#!/usr/bin/env bash
# SQLite-safe snapshot of the Cabbage database (every profile, game and
# head-to-head record). Keeps the last 30.
# Usage:  sudo ops/backup.sh      (cron: 15 3 * * * /opt/cabbage/ops/backup.sh)
set -euo pipefail

DB="${CABBAGE_DB:-/srv/cabbage/cabbage.db}"
BACKUP_DIR="${CABBAGE_BACKUP_DIR:-/srv/cabbage-backups}"

command -v sqlite3 >/dev/null || { echo "error: sqlite3 not installed (apt install sqlite3)" >&2; exit 1; }
[[ -f "$DB" ]] || { echo "no database at $DB yet, nothing to back up"; exit 0; }

install -d "$BACKUP_DIR"
out="$BACKUP_DIR/cabbage-$(date -u +%F-%H%M).db"
sqlite3 "$DB" ".backup '$out'"
gzip -f "$out"
ls -1t "$BACKUP_DIR"/cabbage-*.db.gz | tail -n +31 | xargs -r rm -f
echo "backed up to $out.gz"
