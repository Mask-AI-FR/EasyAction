#!/bin/sh
# Contenu commun à TOUS les formats de paquet : les quatre binaires, le cœur de script, l'application
# web construite. Chaque format ajoute ensuite son enrobage (DEBIAN/, usr/, PKGBUILD…).
#   packaging/build-payload.sh <dossier> <cible-bun>
# À lancer depuis la racine du dépôt.
set -eu

OUT="${1:?usage: packaging/build-payload.sh <dir> <bun-target>}"
BUN_TARGET="${2:?usage: packaging/build-payload.sh <dir> <bun-target>}"

echo "==> Guarding the environment variable list"
bun packaging/check-env-names.ts

echo "==> Building the web application"
bun run build

echo "==> Compiling for $BUN_TARGET"
mkdir -p "$OUT/bin" "$OUT/lib"
bun build --compile --target="$BUN_TARGET" server/index.ts     --outfile "$OUT/bin/easyactions-server"
bun build --compile --target="$BUN_TARGET" scripts/db.ts       --outfile "$OUT/bin/easyactions-migrate"
bun build --compile --target="$BUN_TARGET" scripts/settings.ts --outfile "$OUT/bin/easyactions-settings"
# scripts/users.ts crée le PREMIER administrateur (« le premier se crée ainsi », scripts/users.ts:12).
# Sans ce binaire, une installation n'a aucun moyen d'avoir un administrateur.
bun build --compile --target="$BUN_TARGET" scripts/users.ts    --outfile "$OUT/bin/easyactions-users"

install -m 0644 packaging/common/easyactions-lib.sh "$OUT/lib/easyactions-lib.sh"

# `dist/app` est servi par un chemin relatif au dossier de travail du serveur (server/index.ts:16).
rm -rf "$OUT/dist"
mkdir -p "$OUT/dist"
cp -r dist/app "$OUT/dist/app"
