#!/usr/bin/env bash
# The desktop builds under plain, space-free names in OUT_DIR (CI artifacts and release files):
#   TowerOfLegends-<version>-windows-setup.exe / -windows.msi / -windows-portable.exe
#   TowerOfLegends-<version>-macos.dmg / -macos-app.zip (the .app, unzip and run)
#   TowerOfLegends-<version>-linux-x86_64.AppImage / -linux-amd64.deb / -linux-x86_64.rpm
# The portable Windows .exe is the app itself (its pages are built in; it needs the WebView2
# runtime that Windows 10/11 include). Usage: port/scripts/stage-installers.sh TARGET_DIR OUT_DIR
set -euo pipefail
T=$1; mkdir -p "$2"; O=$(cd "$2" && pwd)
V=$(sed -n 's/^version *= *"\([0-9.]*\)".*/\1/p' "$(dirname "$0")/../../pyproject.toml" | head -1)
N="TowerOfLegends-$V"
one() { # pattern, destination name
  local f; f=$(find "$T" -path "*release/bundle/*" -name "$1" -print -quit 2>/dev/null || true)
  [ -n "$f" ] && cp "$f" "$O/$2" && echo "$O/$2"
  return 0
}
one '*.msi' "$N-windows.msi"
one '*-setup.exe' "$N-windows-setup.exe"
exe=$(find "$T" -path '*/release/*' -name '*.exe' -not -path '*/bundle/*' -not -path '*/deps/*' -not -path '*/build/*' -not -path '*/examples/*' -print -quit 2>/dev/null || true)
[ -n "$exe" ] && cp "$exe" "$O/$N-windows-portable.exe" && echo "$O/$N-windows-portable.exe"
one '*.dmg' "$N-macos.dmg"
app=$(find "$T" -type d -name '*.app' -path '*release/bundle/macos/*' -print -quit 2>/dev/null || true)
if [ -n "$app" ]; then
  (cd "$(dirname "$app")" && ditto -c -k --keepParent "$(basename "$app")" "$O/$N-macos-app.zip") && echo "$O/$N-macos-app.zip"
fi
one '*.AppImage' "$N-linux-x86_64.AppImage"
one '*.deb' "$N-linux-amd64.deb"
one '*.rpm' "$N-linux-x86_64.rpm"
[ -n "$(ls -A "$O")" ] || { echo "nothing staged from $T"; exit 1; }
