#!/bin/sh
# Vérifie que l'archive portable s'extrait, s'installe PAR UTILISATEUR et démarre — le chemin des
# distributions sans dpkg (Arch, Fedora…). Aucun root. ÉCHEC FERMÉ : une archive qui ne répond pas
# sur /health ne doit pas atteindre une Release.
#   packaging/smoke-tarball.sh <version>
set -eu

VERSION="${1:?usage: packaging/smoke-tarball.sh <version>}"
TARBALL="dist/tarball/easyactions-${VERSION}-linux-x64.tar.gz"
[ -f "$TARBALL" ] || { echo "Missing $TARBALL" >&2; exit 1; }

WORK="$(mktemp -d)"
FAKE_HOME="$WORK/home"
mkdir -p "$FAKE_HOME"
cleanup() {
  [ -f "$FAKE_HOME/.local/share/easyactions/easyactions.pid" ] &&
    kill "$(cat "$FAKE_HOME/.local/share/easyactions/easyactions.pid")" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "==> Extracting"
tar -xzf "$TARBALL" -C "$WORK"
ROOT="$WORK/easyactions-${VERSION}-linux-x64"
[ -x "$ROOT/bin/easyactions" ] || { echo "No launcher in the archive" >&2; exit 1; }

# Port distinct du 8094 par défaut : l'intégration continue peut déjà avoir quelque chose dessus.
PORT=8214
sed -i "s|^PORT=8094|PORT=$PORT|; s|^APP_ORIGIN=http://127.0.0.1:8094|APP_ORIGIN=http://127.0.0.1:$PORT|" \
  "$ROOT/lib/easyactions-lib.sh"

export HOME="$FAKE_HOME"
export XDG_DATA_HOME="$FAKE_HOME/.local/share"
export XDG_CONFIG_HOME="$FAKE_HOME/.config"
export XDG_BIN_HOME="$FAKE_HOME/.local/bin"

echo "==> Refusing an operator command before first run"
if "$ROOT/bin/easyactions" settings:setup-code >/dev/null 2>&1; then
  echo "settings:setup-code succeeded before the account was configured" >&2; exit 1
fi
echo "    fails closed OK"

echo "==> install.sh"
"$ROOT/install.sh" >/dev/null
[ -L "$XDG_BIN_HOME/easyactions" ] || { echo "install.sh did not create the symlink" >&2; exit 1; }
[ -f "$XDG_DATA_HOME/applications/easyactions.desktop" ] || { echo "No desktop entry" >&2; exit 1; }

# `start` et non le lancement par défaut : ouvrir un navigateur bloquerait indéfiniment ici.
echo "==> Starting"
"$XDG_BIN_HOME/easyactions" start

echo "==> Probing"
HEALTH="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health")" || {
  echo "No answer on /health" >&2; cat "$XDG_DATA_HOME/easyactions/server.log" >&2; exit 1; }
echo "    /health -> $HEALTH"
case "$HEALTH" in *'"service":"pipliner"'*) ;; *) echo "Unexpected /health body" >&2; exit 1 ;; esac

STATUS="$(curl -fsS --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"
[ "$STATUS" = "200" ] || { echo "The web app answered $STATUS" >&2; exit 1; }
echo "    / -> 200"

"$XDG_BIN_HOME/easyactions" db:status
"$XDG_BIN_HOME/easyactions" settings:setup-code >/dev/null && echo "    settings:setup-code OK"

echo "==> Stopping"
"$XDG_BIN_HOME/easyactions" stop
echo "Smoke test passed."
