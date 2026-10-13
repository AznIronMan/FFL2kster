#!/usr/bin/env bash
# Packaging check for the desktop builds (CI): no ROM, save or state file anywhere in the bundles
# or inside the Linux packages / macOS app, and the web build they embed passes the no-content check.
# Usage: port/scripts/check-bundles.sh TARGET_DIR [WEB_DIST]   (checks every */release/bundle in it)
set -euo pipefail
R=$1; D=${2:-}
B=$(find "$R" -type d -path '*release/bundle' | head -1)
[ -n "$B" ] || { echo "no bundle directory under $R"; exit 1; }
pat='\.(gb|gbc|sgb|sav|srm|state|zip)$'
tmp=$(mktemp -d)
listing() {
  find "$B" -type f
  find "$B" -name '*.deb' -print0 | while IFS= read -r -d '' f; do dpkg-deb -c "$f" | awk '{print $6}'; done
  find "$B" -name '*.rpm' -print0 | while IFS= read -r -d '' f; do (command -v rpm >/dev/null && rpm -qlp "$f") || true; done
  find "$B" -name '*.AppImage' -print0 | while IFS= read -r -d '' f; do
    f="$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"
    (cd "$tmp" && chmod +x "$f" && "$f" --appimage-extract >/dev/null 2>&1 && find squashfs-root -type f) || true
  done
  find "$B" -maxdepth 3 -name '*.app' -type d -print0 | while IFS= read -r -d '' a; do find "$a" -type f; done
}
bad=$(listing | grep -Ei "$pat" || true)
rm -rf "$tmp"
if [ -n "$bad" ]; then echo "game-content-like files in the bundles:"; echo "$bad"; exit 1; fi
[ -n "$D" ] && node "$(dirname "$0")/check-no-content.mjs" "$D"
echo "no game content in $B"
