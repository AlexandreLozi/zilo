#!/bin/sh
# Zilo agent uninstaller (macOS pkgs have no built-in uninstall). Run with sudo.
# Removes exactly what the SP-4a pkg installs, then forgets the package receipt.
set -u
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
app="/Applications/Zilo Agent.app"
plist="/Library/LaunchAgents/dev.zilo.agent.plist"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

for uid in $(ps -axo uid= -o comm= | awk '/loginwindow/ {print $1}' | sort -u); do
  launchctl bootout "gui/$uid/dev.zilo.agent" 2>/dev/null || true
done
[ -x "$lsregister" ] && "$lsregister" -u "$app" 2>/dev/null || true
rm -f "$plist"
rm -rf "$app"
pkgutil --forget dev.zilo.agent >/dev/null 2>&1 || true
echo "Zilo Agent removed"
