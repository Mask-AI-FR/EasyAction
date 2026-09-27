#!/bin/sh
# Cœur commun à tous les formats de paquet (Debian, archive portable, Arch). SOURCÉ, jamais exécuté :
# pas de `set -eu` ici, c'est au point d'entrée. L'appelant DOIT avoir défini INSTALL_DIR — le paquet
# Debian le pose en /opt/easyactions, l'archive portable se déplace où l'on veut.
: "${INSTALL_DIR:?INSTALL_DIR must be set before sourcing easyactions-lib.sh}"

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/easyactions"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/easyactions"
ENV_FILE="$CONFIG_DIR/env"
PID_FILE="$DATA_DIR/easyactions.pid"
LOG_FILE="$DATA_DIR/server.log"

# Navigateurs Chromium, même ordre que scripts/desktop.ts:17-26 : eux seuls savent ouvrir une
# application web dans sa propre fenêtre (`--app=`).
CHROMIUM_BROWSERS="brave brave-browser chromium chromium-browser google-chrome-stable google-chrome microsoft-edge-stable vivaldi-stable"

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

# PREMIER LANCEMENT. Les deux secrets sont tirés ICI, une fois par compte : livrés dans le paquet ils
# seraient identiques partout, donc publics. `/dev/urandom` + base64 évitent de dépendre d'openssl.
# 32 octets → 44 caractères, au-dessus du minimum de 32 (server/schemas/env.schema.ts:64).
ensure_config() {
  [ -f "$ENV_FILE" ] && return 0
  mkdir -p "$CONFIG_DIR" "$DATA_DIR"
  chmod 700 "$CONFIG_DIR" "$DATA_DIR"
  (
    umask 077
    cat > "$ENV_FILE" <<ENVEOF
HOST=127.0.0.1
PORT=8094
APP_ORIGIN=http://127.0.0.1:8094
SESSION_SECRET=$(head -c 32 /dev/urandom | base64)
DATA_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)
DATABASE_PATH=$DATA_DIR/pipliner.sqlite
HTTP_IDLE_TIMEOUT_SECONDS=240
SESSION_MAX_DAYS=30
SESSIONS_PER_USER_MAX=5
AUDIT_RETENTION_DAYS=365
TWO_FACTOR_EVERY_HOURS=24
TWO_FACTOR_MAX_ATTEMPTS=5
TWO_FACTOR_LOCK_MINUTES=15
ENVEOF
  )
  say "First run: configuration written to $ENV_FILE"
}

# ÉCHEC FERMÉ : sur un compte qui n'a jamais lancé l'application il n'y a pas de clé de chiffrement.
# En tirer une ici rendrait illisible une base créée plus tard avec une autre.
require_config() {
  [ -f "$ENV_FILE" ] || die "EasyActions is not set up for this account yet. Run 'easyactions' once, then try again."
}

load_config() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

usage() {
  cat <<'USAGE'
EasyActions - run GitHub Actions across a whole organization

  easyactions                             open the app in its own window
  easyactions start                       start the server without opening a window

  easyactions settings:setup-code         print the code that opens the /setup page
  easyactions settings:setup-code --reset forget the GitHub connection and start over

  easyactions users:promote <login>       make someone an admin (the first one is made this way)
  easyactions users:demote <login>        take the admin role away
  easyactions users:reset-two-factor <login>   remove their authenticator app

  easyactions db:migrate                  bring the database up to date
  easyactions db:status                   show the schema version
  easyactions db:rollback [--yes]         undo the last migration

  easyactions stop                        stop the background server
  easyactions help                        this message

Data lives in ~/.local/share/easyactions, settings in ~/.config/easyactions.
USAGE
}

# Les noms de sous-commandes reprennent EXACTEMENT ceux de package.json : une seule liste à retenir,
# qu'on travaille depuis le dépôt (`bun run settings:setup-code`) ou depuis un paquet installé.
run_operator_command() {
  command_name="$1"
  shift
  require_config
  load_config
  cd "$INSTALL_DIR" || die "Cannot enter $INSTALL_DIR"
  case "$command_name" in
    settings:setup-code) exec ./bin/easyactions-settings setup-code "$@" ;;
    users:promote) exec ./bin/easyactions-users promote "$@" ;;
    users:demote) exec ./bin/easyactions-users demote "$@" ;;
    users:reset-two-factor) exec ./bin/easyactions-users reset-two-factor "$@" ;;
    db:migrate) exec ./bin/easyactions-migrate migrate "$@" ;;
    db:status) exec ./bin/easyactions-migrate status "$@" ;;
    db:rollback) exec ./bin/easyactions-migrate rollback "$@" ;;
    *) die "Unknown command: $command_name. Run 'easyactions help'." ;;
  esac
}

server_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

launch_server() {
  cd "$INSTALL_DIR" || die "Cannot enter $INSTALL_DIR"
  # `setsid` : le serveur doit SURVIVRE au lanceur, qui se remplace ensuite par le navigateur. Sans
  # nouvelle session il reste dans son groupe de processus et meurt avec la fenêtre ; même besoin
  # que le `detached: true` de scripts/desktop.ts:64.
  setsid ./bin/easyactions-server >>"$LOG_FILE" 2>&1 </dev/null &
  echo $! > "$PID_FILE"
  # ÉCHEC FERMÉ : pas de fenêtre ni d'annonce sur un serveur absent. 20 s, comme scripts/desktop.ts:29.
  i=0
  while [ "$i" -lt 100 ]; do
    curl -fsS --max-time 1 "$APP_ORIGIN/health" >/dev/null 2>&1 && break
    i=$((i + 1))
    sleep 0.2
  done
  [ "$i" -lt 100 ] || die "EasyActions did not start within 20 s. See $LOG_FILE."
}

stop_server() {
  if server_running; then
    kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE"
    say "EasyActions stopped."
  else
    say "EasyActions is not running."
  fi
}

# Démarrage SANS fenêtre : pour un serveur sans écran, pour l'unité systemd, et pour les essais
# d'intégration continue, où ouvrir un navigateur bloquerait indéfiniment.
start_server_only() {
  ensure_config
  load_config
  "$INSTALL_DIR/bin/easyactions-migrate" migrate >/dev/null
  if server_running; then
    say "EasyActions is already running on $APP_ORIGIN."
    return 0
  fi
  launch_server
  say "EasyActions is running on $APP_ORIGIN."
}

start_and_open() {
  ensure_config
  load_config
  # Migrations : le serveur ne les applique JAMAIS lui-même (server/db/migrator.ts:7-9) et refuse de
  # démarrer sur un schéma en retard (server/db/database.ts:60-67). `migrate` est idempotent.
  "$INSTALL_DIR/bin/easyactions-migrate" migrate >/dev/null

  # « One Bun process only » (docs/SECURITY.md:50) : la coordination des renouvellements de jetons
  # est en mémoire. Deux processus sur la même base se voleraient un jeton de rafraîchissement.
  server_running || launch_server

  url="$APP_ORIGIN/orgs"
  for name in $CHROMIUM_BROWSERS; do
    if command -v "$name" >/dev/null 2>&1; then
      exec "$name" "--app=$url"
    fi
  done
  say "No Chromium browser found. Open $url in Brave, Chrome or Edge."
}

easyactions_main() {
  case "${1:-}" in
    "") start_and_open ;;
    help | --help | -h) usage ;;
    start) start_server_only ;;
    stop) stop_server ;;
    *) run_operator_command "$@" ;;
  esac
}
