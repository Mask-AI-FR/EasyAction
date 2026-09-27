#!/bin/sh
# Installation PAR UTILISATEUR de l'archive portable : aucun root, rien hors de $HOME. Fonctionne sur
# toute distribution (Arch, Fedora, openSUSE…), là où un .deb ne s'installe pas.
#   ./install.sh            installe pour l'utilisateur courant
#   ./install.sh --uninstall  retire les raccourcis (les données restent)
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN_DIR/easyactions" "$APPS_DIR/easyactions.desktop"
  for size in 16 32 48 64 128 192 256 512; do
    rm -f "$ICONS_DIR/${size}x${size}/apps/easyactions.png"
  done
  echo "Shortcuts removed. Your data is still in ~/.local/share/easyactions."
  exit 0
fi

mkdir -p "$BIN_DIR" "$APPS_DIR"
ln -sf "$ROOT/bin/easyactions" "$BIN_DIR/easyactions"

for size in 16 32 48 64 128 192 256 512; do
  src="$ROOT/share/icons/hicolor/${size}x${size}/apps/easyactions.png"
  [ -f "$src" ] || continue
  mkdir -p "$ICONS_DIR/${size}x${size}/apps"
  cp -f "$src" "$ICONS_DIR/${size}x${size}/apps/easyactions.png"
done

# `Exec` porte le chemin ABSOLU : l'archive peut vivre n'importe où, et $HOME/.local/bin n'est pas
# toujours dans le PATH des lanceurs graphiques.
sed "s|^Exec=.*|Exec=$ROOT/bin/easyactions|" "$ROOT/share/applications/easyactions.desktop" \
  > "$APPS_DIR/easyactions.desktop"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$APPS_DIR" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -f "$ICONS_DIR" 2>/dev/null || true

cat <<NEXT

EasyActions is installed for $(id -un).

Three steps to get going:

  1. Start it                     easyactions
  2. Connect your GitHub App      easyactions settings:setup-code
  3. Make yourself an admin       easyactions users:promote <your-github-login>

Run 'easyactions help' for everything else.
NEXT

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "NOTE: $BIN_DIR is not in your PATH. Add it, or run $ROOT/bin/easyactions directly." ;;
esac
