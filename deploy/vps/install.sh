#!/bin/sh
# Install or update the ALMATAFI backend on the VPS (see deploy/README.md). Run as root:
#   sh deploy/vps/install.sh
# Safe to re-run. Everything runs as the unprivileged user "almatafi" (rootless Podman, no
# daemon, no published ports); nothing else on the machine is touched.
set -eu

U=almatafi
H=/home/$U
HERE=$(cd "$(dirname "$0")" && pwd)

id "$U" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --comment "ALMATAFI API (rootless podman)" "$U"
passwd -l "$U" >/dev/null
chmod 750 "$H"
loginctl enable-linger "$U"
N=$(id -u "$U")
as_user() { (cd /tmp && sudo -u "$U" XDG_RUNTIME_DIR=/run/user/$N DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$N/bus "$@"); }

install -d -o "$U" -g "$U" -m 700 "$H/.config" "$H/.config/almatafi" "$H/.config/containers" \
  "$H/.config/containers/systemd" "$H/.config/systemd" "$H/.config/systemd/user" \
  "$H/.config/systemd/user/podman-auto-update.timer.d"
install -o "$U" -g "$U" -m 644 "$HERE/almatafi.network" "$HERE/almatafi-api.container" \
  "$HERE/almatafi-tunnel.container" "$H/.config/containers/systemd/"
install -o "$U" -g "$U" -m 644 "$HERE/podman-auto-update.timer.d/every-5-min.conf" \
  "$H/.config/systemd/user/podman-auto-update.timer.d/"
[ -f "$H/.config/almatafi/api.env" ] || install -o "$U" -g "$U" -m 600 "$HERE/api.env.example" "$H/.config/almatafi/api.env"
# The tunnel's credentials JSON must already be in ~/.cloudflared (deploy/README.md, "Tunnel").
# Owned by almatafi, so rootless Podman may hand it to the container's user (the :U mount).
install -o "$U" -g "$U" -m 644 "$HERE/cloudflared.yml" "$H/.cloudflared/config.yml"

as_user systemctl --user daemon-reload
as_user systemctl --user enable --now podman-auto-update.timer
as_user systemctl --user restart almatafi-api.service almatafi-tunnel.service
as_user systemctl --user --no-pager status almatafi-api.service almatafi-tunnel.service | grep -E "●|Active:"
