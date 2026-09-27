#!/bin/sh
# Assemble le paquet Debian d'EasyActions.
#   packaging/build-deb.sh <version> [arch]
# La version vient de l'étiquette git, sans le « v » ; l'architecture vaut amd64 par défaut.
# À lancer depuis la racine du dépôt.
set -eu

VERSION="${1:?usage: packaging/build-deb.sh <version> [arch]}"
ARCH="${2:-amd64}"
MAINTAINER="${DEB_MAINTAINER:-Mask-AI-FR <noreply@mask-ai.fr>}"

# Debian trie « ~ » AVANT la version vide : 1.0.0~rc1 précède 1.0.0, alors que 1.0.0-rc1 la suivrait
# et rendrait la préversion « plus récente » que la version finale.
DEB_VERSION="$(printf '%s' "$VERSION" | sed 's/-/~/')"

case "$ARCH" in
  amd64) BUN_TARGET=bun-linux-x64 ;;
  arm64) BUN_TARGET=bun-linux-arm64 ;;
  *) echo "Unsupported architecture: $ARCH (expected amd64 or arm64)" >&2; exit 1 ;;
esac

STAGE="dist/deb/easyactions_${DEB_VERSION}_${ARCH}"
OUT="dist/deb/easyactions_${DEB_VERSION}_${ARCH}.deb"

rm -rf "$STAGE"
mkdir -p "$STAGE/DEBIAN" "$STAGE/usr/bin" "$STAGE/usr/share/applications" "$STAGE/usr/lib/systemd/user"
packaging/build-payload.sh "$STAGE/opt/easyactions" "$BUN_TARGET"

echo "==> Laying out the package"
install -m 0755 packaging/common/easyactions-system "$STAGE/usr/bin/easyactions"
install -m 0644 packaging/deb/easyactions.desktop "$STAGE/usr/share/applications/easyactions.desktop"
install -m 0644 packaging/systemd/easyactions.service "$STAGE/usr/lib/systemd/user/easyactions.service"
install -m 0755 packaging/deb/postinst "$STAGE/DEBIAN/postinst"
install -m 0755 packaging/deb/postrm "$STAGE/DEBIAN/postrm"

# Jeu d'icônes SOMBRE : c'est l'icône principale d'après EasyActions-Logo-Pack-v2/README.txt.
for size in 16 32 48 64 128 192 256 512; do
  src="EasyActions-Logo-Pack-v2/png/app-icons/dark/easyactions-icon-${size}.png"
  [ -f "$src" ] || { echo "Missing icon: $src" >&2; exit 1; }
  mkdir -p "$STAGE/usr/share/icons/hicolor/${size}x${size}/apps"
  install -m 0644 "$src" "$STAGE/usr/share/icons/hicolor/${size}x${size}/apps/easyactions.png"
done

# Dépendances DÉRIVÉES du binaire, jamais écrites de mémoire. dpkg-shlibdeps veut un debian/control :
# on lui en fabrique un jetable. `curl` est ajouté à la main — le lanceur s'en sert pour attendre
# /health, et aucun binaire ne le révèle.
echo "==> Deriving Depends"
DEPENDS="libc6, curl"
if command -v dpkg-shlibdeps >/dev/null 2>&1; then
  TMPCTL="$(mktemp -d)"
  mkdir -p "$TMPCTL/debian"
  printf 'Source: easyactions\n\nPackage: easyactions\nArchitecture: %s\n' "$ARCH" > "$TMPCTL/debian/control"
  : > "$TMPCTL/debian/substvars"
  if (cd "$TMPCTL" && dpkg-shlibdeps -O --ignore-missing-info \
        "$OLDPWD/$STAGE/opt/easyactions/bin/easyactions-server" 2>/dev/null) > "$TMPCTL/out"; then
    derived="$(sed -n 's/^shlibs:Depends=//p' "$TMPCTL/out")"
    [ -n "$derived" ] && DEPENDS="$derived, curl"
  fi
  rm -rf "$TMPCTL"
else
  echo "    dpkg-shlibdeps not found; falling back to: $DEPENDS" >&2
fi
echo "    Depends: $DEPENDS"

sed -e "s|@VERSION@|$DEB_VERSION|" -e "s|@ARCH@|$ARCH|" -e "s|@DEPENDS@|$DEPENDS|" \
    -e "s|@MAINTAINER@|$MAINTAINER|" packaging/deb/control.in > "$STAGE/DEBIAN/control"

echo "==> Building $OUT"
# --root-owner-group : sans lui chaque fichier appartient à l'uid du runner (1001 sur GitHub).
dpkg-deb --build --root-owner-group "$STAGE" "$OUT"
echo "$OUT"
