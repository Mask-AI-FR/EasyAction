#!/bin/sh
# Archive portable d'EasyActions : la même charge utile que le paquet Debian, installable PAR
# UTILISATEUR sur n'importe quelle distribution. C'est ce qui marche là où dpkg n'existe pas (Arch…).
#   packaging/build-tarball.sh <version> [arch]
set -eu

VERSION="${1:?usage: packaging/build-tarball.sh <version> [arch]}"
ARCH="${2:-x64}"

case "$ARCH" in
  x64) BUN_TARGET=bun-linux-x64 ;;
  arm64) BUN_TARGET=bun-linux-arm64 ;;
  *) echo "Unsupported architecture: $ARCH (expected x64 or arm64)" >&2; exit 1 ;;
esac

NAME="easyactions-${VERSION}-linux-${ARCH}"
STAGE="dist/tarball/$NAME"
OUT="dist/tarball/${NAME}.tar.gz"

rm -rf "$STAGE"
mkdir -p "$STAGE/share/applications"
packaging/build-payload.sh "$STAGE" "$BUN_TARGET"

echo "==> Laying out the archive"
install -m 0755 packaging/tarball/easyactions "$STAGE/bin/easyactions"
install -m 0755 packaging/tarball/install.sh "$STAGE/install.sh"
install -m 0644 packaging/deb/easyactions.desktop "$STAGE/share/applications/easyactions.desktop"
install -m 0644 packaging/tarball/README.md "$STAGE/README.md"

for size in 16 32 48 64 128 192 256 512; do
  src="EasyActions-Logo-Pack-v2/png/app-icons/dark/easyactions-icon-${size}.png"
  [ -f "$src" ] || { echo "Missing icon: $src" >&2; exit 1; }
  mkdir -p "$STAGE/share/icons/hicolor/${size}x${size}/apps"
  install -m 0644 "$src" "$STAGE/share/icons/hicolor/${size}x${size}/apps/easyactions.png"
done

echo "==> Building $OUT"
tar -czf "$OUT" -C dist/tarball "$NAME"
echo "$OUT"
