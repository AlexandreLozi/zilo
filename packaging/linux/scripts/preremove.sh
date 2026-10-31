#!/bin/sh
# Zilo agent preremove (deb prerm / rpm %preun). No network access.
# Disables the global user-unit enablement only on real removal, not on upgrade:
#   deb: $1 = remove | upgrade | deconfigure | failed-upgrade
#   rpm: $1 = 0 (erase) | 1+ (upgrade)
set -e
case "${1:-}" in
  remove|deconfigure|0) removing=1 ;;
  *) removing=0 ;;
esac
if [ "$removing" = 1 ]; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --global disable zilo-agent.service >/dev/null 2>&1 || true
  fi
  # Fallback when systemctl is absent: remove the symlink the postinstall may have created.
  rm -f /etc/systemd/user/default.target.wants/zilo-agent.service
  rmdir /etc/systemd/user/default.target.wants 2>/dev/null || true
fi
exit 0
