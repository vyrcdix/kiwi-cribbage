#!/usr/bin/env bash
# Pull, build and restart Cabbage. Games in progress survive: state is saved
# after every move and players' browsers reconnect on their own.
# Usage:  sudo ops/update.sh
set -euo pipefail

CODE_DIR="${CABBAGE_CODE_DIR:-/opt/cabbage}"
SERVICE_USER="${CABBAGE_SERVICE_USER:-cabbage}"

[[ $EUID -eq 0 ]] || { echo "error: must run as root (sudo)" >&2; exit 1; }

"$CODE_DIR/ops/backup.sh"
sudo -u "$SERVICE_USER" bash -lc "cd '$CODE_DIR' && git pull --ff-only && npm install && npm --prefix server install && npm run build"
systemctl restart cabbage
sleep 2
curl -fsS http://127.0.0.1:8521/api/health && echo && echo "update complete"
