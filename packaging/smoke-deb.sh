#!/bin/sh
# Vérifie qu'un paquet Debian construit s'INSTALLE et DÉMARRE, avant de le publier. ÉCHEC FERMÉ : un
# paquet qui ne répond pas sur /health ne doit pas atteindre une Release.
#
# `easyactions start` plutôt que le lancement par défaut : celui-ci finit par un navigateur, que
# l'intégration continue n'a pas — et s'il en trouve un, il bloque indéfiniment.
set -eu

DEB="$(ls dist/deb/*.deb | head -1)"
[ -n "$DEB" ] || { echo "No .deb in dist/deb" >&2; exit 1; }

WORK="$(mktemp -d)"
FAKE_HOME="$WORK/home"
mkdir -p "$FAKE_HOME"
cleanup() {
  [ -f "$FAKE_HOME/.local/share/easyactions/easyactions.pid" ] &&
    kill "$(cat "$FAKE_HOME/.local/share/easyactions/easyactions.pid")" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "==> Installing $DEB"
sudo dpkg -i "$DEB" || sudo apt-get -f install -y

echo "==> Checking the installed layout"
for f in /usr/bin/easyactions /opt/easyactions/lib/easyactions-lib.sh \
         /opt/easyactions/bin/easyactions-server /opt/easyactions/bin/easyactions-migrate \
         /opt/easyactions/bin/easyactions-settings /opt/easyactions/bin/easyactions-users \
         /opt/easyactions/dist/app/index.html /usr/share/applications/easyactions.desktop \
         /usr/lib/systemd/user/easyactions.service; do
  [ -e "$f" ] || { echo "Missing from the installed package: $f" >&2; exit 1; }
done
echo "    layout OK"

# Port distinct du 8094 par défaut : l'intégration continue peut déjà avoir quelque chose dessus.
PORT=8213
sudo sed -i "s|^PORT=8094|PORT=$PORT|; s|^APP_ORIGIN=http://127.0.0.1:8094|APP_ORIGIN=http://127.0.0.1:$PORT|" \
  /opt/easyactions/lib/easyactions-lib.sh

export HOME="$FAKE_HOME"
export XDG_DATA_HOME="$FAKE_HOME/.local/share"
export XDG_CONFIG_HOME="$FAKE_HOME/.config"

echo "==> Refusing an operator command before first run"
if /usr/bin/easyactions settings:setup-code >/dev/null 2>&1; then
  echo "'easyactions settings:setup-code' succeeded before the account was configured" >&2
  exit 1
fi
echo "    fails closed OK"

echo "==> Starting"
/usr/bin/easyactions start

echo "==> Probing"
HEALTH="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health")" || {
  echo "No answer on /health" >&2
  cat "$XDG_DATA_HOME/easyactions/server.log" >&2
  exit 1
}
echo "    /health -> $HEALTH"
case "$HEALTH" in *'"service":"pipliner"'*) ;; *) echo "Unexpected /health body" >&2; exit 1 ;; esac

STATUS="$(curl -fsS --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"
[ "$STATUS" = "200" ] || { echo "The web app answered $STATUS" >&2; exit 1; }
echo "    / -> 200"

/usr/bin/easyactions db:status
/usr/bin/easyactions settings:setup-code >/dev/null && echo "    settings:setup-code OK"

echo "==> Stopping and removing"
/usr/bin/easyactions stop
sudo dpkg --purge easyactions
[ ! -e /opt/easyactions ] || { echo "/opt/easyactions survived purge" >&2; exit 1; }
echo "Smoke test passed."
