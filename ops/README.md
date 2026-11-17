# ops/ — running Cabbage on the Steep box

Cabbage sits beside Steep (kennel) on the same server, using the same pieces:
Node 24, Caddy, systemd, SQLite. It is one process on `127.0.0.1:8521`, served
at `https://cabbage.steep.work`.

All commands run **on the box**, as root.

| File | What it is |
|---|---|
| `cabbage.service` | systemd unit |
| `cabbage.caddy` | Caddy route (drops into `/etc/caddy/tenants/`) |
| `update.sh` | back up, pull, build, restart |
| `backup.sh` | SQLite-safe database snapshot, keeps 30 |

## First install

```sh
# 1. user, code, data dir
useradd --system --create-home --shell /usr/sbin/nologin cabbage
git clone https://github.com/vyrcdix/kiwi-cribbage.git /opt/cabbage && chown -R cabbage:cabbage /opt/cabbage
install -d -o cabbage -g cabbage /srv/cabbage

# 2. build
sudo -u cabbage bash -lc 'cd /opt/cabbage && npm install && npm --prefix server install && npm run build'
# npm 12 blocks dependencies' install scripts, which leaves better-sqlite3 without
# its compiled binary: the service then crash-loops and the site answers 502.
# Run the package's own install script (needs build-essential and python3 only
# if no prebuilt binary is available):
sudo -u cabbage bash -lc 'cd /opt/cabbage/server/node_modules/better-sqlite3 && npm run install'
ls /opt/cabbage/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node

# 3. config
install -d /etc/cabbage
cat > /etc/cabbage/cabbage.env <<'EOF'
NODE_ENV=production
HOST=127.0.0.1
PORT=8521
CABBAGE_DB=/srv/cabbage/cabbage.db
EOF
chmod 600 /etc/cabbage/cabbage.env

# 4. service
cp /opt/cabbage/ops/cabbage.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cabbage
curl -s http://127.0.0.1:8521/api/health        # {"ok":true}

# 5. front door
install -d /etc/caddy/tenants
cp /opt/cabbage/ops/cabbage.caddy /etc/caddy/tenants/
# The main Caddyfile must import the tenants folder, or Caddy never reads the
# route and the browser shows ERR_SSL_PROTOCOL_ERROR. Add the line if it is missing:
grep -q 'import /etc/caddy/tenants/\*.caddy' /etc/caddy/Caddyfile \
  || printf '\nimport /etc/caddy/tenants/*.caddy\n' >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
curl -s https://cabbage.steep.work/api/health   # {"ok":true}, up to a minute after the reload

# 6. nightly backup
echo '15 3 * * * root /opt/cabbage/ops/backup.sh' > /etc/cron.d/cabbage-backup
```

**DNS:** if the `*.steep.work` wildcard record from the Steep multi-user setup
exists, nothing to do. Otherwise add `cabbage.steep.work  A  <vps-ip>`; Caddy
issues a certificate on the first request.

**Port:** 8521 is clear of the Steep band (8421 upward).

## Day to day

```sh
sudo /opt/cabbage/ops/update.sh         # deploy the latest code
sudo /opt/cabbage/ops/backup.sh         # snapshot now
journalctl -u cabbage -n 50             # logs
```

Restarting mid-game is safe: state is written after every move, and browsers
reconnect and pick up where they were.

## Restore

```sh
systemctl stop cabbage
gunzip -c /srv/cabbage-backups/cabbage-<stamp>.db.gz > /srv/cabbage/cabbage.db
rm -f /srv/cabbage/cabbage.db-wal /srv/cabbage/cabbage.db-shm
chown cabbage:cabbage /srv/cabbage/cabbage.db
systemctl start cabbage
```
