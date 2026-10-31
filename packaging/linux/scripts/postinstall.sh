#!/bin/sh
# Zilo agent postinstall (deb postinst / rpm %post). No network access.
# Enables the systemd --user unit for every user (D-008: per-user autostart at login).
# `systemctl --global enable` only writes symlinks under /etc/systemd/user, so it also
# works where systemd is not running (containers, chroots).
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl --global enable zilo-agent.service >/dev/null 2>&1 || true
fi
exit 0
