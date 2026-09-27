#!/bin/sh
# Produit le PKGBUILD d'Arch Linux pour une archive DÉJÀ construite : la somme de contrôle vient du
# fichier, jamais d'une saisie. Ne construit pas le .pkg.tar.zst — cela demande makepkg, donc un
# conteneur Arch ; les utilisateurs font `makepkg -si` avec ce fichier.
#   packaging/build-arch.sh <version>
set -eu

VERSION="${1:?usage: packaging/build-arch.sh <version>}"
MAINTAINER="${DEB_MAINTAINER:-Mask-AI-FR <noreply@mask-ai.fr>}"
TARBALL="dist/tarball/easyactions-${VERSION}-linux-x64.tar.gz"
OUT_DIR="dist/arch"

[ -f "$TARBALL" ] || { echo "Missing $TARBALL. Run packaging/build-tarball.sh first." >&2; exit 1; }

# pacman refuse « - » dans pkgver : 1.0.0-rc.1 devient 1.0.0rc.1, tout en gardant la vraie version
# dans l'URL de l'archive.
PKGVER="$(printf '%s' "$VERSION" | tr -d '-')"
SHA256="$(sha256sum "$TARBALL" | cut -d' ' -f1)"

mkdir -p "$OUT_DIR"
# Fichiers que le PKGBUILD installe mais que l'archive ne contient pas : ils voyagent à côté.
install -m 0755 packaging/common/easyactions-system "$OUT_DIR/easyactions-system"
install -m 0644 packaging/systemd/easyactions.service "$OUT_DIR/easyactions.service"

SHA256_ENTRY="$(sha256sum "$OUT_DIR/easyactions-system" | cut -d' ' -f1)"
SHA256_UNIT="$(sha256sum "$OUT_DIR/easyactions.service" | cut -d' ' -f1)"

sed -e "s|@VERSION@|$VERSION|g" -e "s|@PKGVER@|$PKGVER|g" -e "s|@SHA256@|$SHA256|g" \
    -e "s|@SHA256_ENTRY@|$SHA256_ENTRY|g" -e "s|@SHA256_UNIT@|$SHA256_UNIT|g" \
    -e "s|@MAINTAINER@|$MAINTAINER|g" packaging/arch/PKGBUILD.in > "$OUT_DIR/PKGBUILD"

echo "$OUT_DIR/PKGBUILD"
