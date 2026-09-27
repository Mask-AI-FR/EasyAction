#!/bin/sh
# Vérifie qu'un paquet construit s'INSTALLE et DÉMARRE, avant de le publier. ÉCHEC FERMÉ : un paquet
# qui ne répond pas sur /health ne doit pas atteindre une Release.
#
# Le lanceur n'est pas appelé ici : il se termine par un navigateur, que l'intégration continue n'a
# pas. On exerce les binaires installés directement, avec la même configuration que lui.
set -eu

DEB="$(ls dist/deb/*.deb | head -1)"
[ -n "$DEB" ] || { echo "No .deb in dist/deb" >&2; exit 1; }
PORT=8213
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Installing $DEB"
sudo dpkg -i "$DEB" || sudo apt-get -f install -y

echo "==> Checking the installed layout"
for f in /usr/bin/easyactions /opt/easyactions/bin/easyactions-server \
         /opt/easyactions/bin/easyactions-migrate /opt/easyactions/bin/easyactions-settings \
         /opt/easyactions/dist/app/index.html /usr/share/applications/easyactions.desktop \
         /usr/lib/systemd/user/easyactions.service; do
  [ -e "$f" ] || { echo "Missing from the installed package: $f" >&2; exit 1; }
done
echo "    layout OK"

export HOST=127.0.0.1
export PORT
export APP_ORIGIN="http://127.0.0.1:$PORT"
export SESSION_SECRET="$(head -c 32 /dev/urandom | base64)"
export DATA_ENCRYPTION_KEY="$(head -c 32 /dev/urandom | base64)"
export DATABASE_PATH="$WORK/pipliner.sqlite"
export HTTP_IDLE_TIMEOUT_SECONDS=240
export SESSION_MAX_DAYS=30
export SESSIONS_PER_USER_MAX=5
export AUDIT_RETENTION_DAYS=365
export TWO_FACTOR_EVERY_HOURS=24
export TWO_FACTOR_MAX_ATTEMPTS=5
export TWO_FACTOR_LOCK_MINUTES=15

echo "==> Migrating"
/opt/easyactions/bin/easyactions-migrate migrate

echo "==> Starting the server"
cd /opt/easyactions
setsid ./bin/easyactions-server >"$WORK/server.log" 2>&1 </dev/null &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"' EXIT

i=0
while [ "$i" -lt 100 ]; do
  curl -fsS --max-time 1 "$APP_ORIGIN/health" >/dev/null 2>&1 && break
  i=$((i + 1))
  sleep 0.2
done

echo "==> Probing"
HEALTH="$(curl -fsS --max-time 5 "$APP_ORIGIN/health")" || { echo "No answer on /health" >&2; cat "$WORK/server.log" >&2; exit 1; }
echo "    /health -> $HEALTH"
case "$HEALTH" in *'"service":"pipliner"'*) ;; *) echo "Unexpected /health body" >&2; exit 1 ;; esac

STATUS="$(curl -fsS --max-time 5 -o /dev/null -w '%{http_code}' "$APP_ORIGIN/")"
echo "    / -> $STATUS"
[ "$STATUS" = "200" ] || { echo "The web app did not answer 200" >&2; exit 1; }

/opt/easyactions/bin/easyactions-settings setup-code >/dev/null
echo "    setup-code OK"

echo "==> Removing"
kill "$SERVER_PID" 2>/dev/null || true
sudo dpkg --purge easyactions
[ ! -e /opt/easyactions ] || { echo "/opt/easyactions survived purge" >&2; exit 1; }
echo "Smoke test passed."
