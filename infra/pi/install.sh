#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

APP_USER="cheekypony"
APP_ROOT="/opt/cheeky-pony"
CONFIG_DIR="/etc/cheeky-pony"

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_ROOT}" "${CONFIG_DIR}" /var/lib/cheeky-pony
install -m 0644 infra/pi/kismet_site.conf /etc/kismet/kismet_site.conf
install -m 0644 infra/pi/cheeky-pony-sensor.service /etc/systemd/system/cheeky-pony-sensor.service

if [ ! -f "${CONFIG_DIR}/sensor.toml" ]; then
  install -m 0640 -o "${APP_USER}" -g "${APP_USER}" /dev/null "${CONFIG_DIR}/sensor.toml"
  cat >"${CONFIG_DIR}/sensor.toml" <<'EOF'
sensor_id = "replace-me"
sensor_name = "cheeky-pony-pi"
backend_ws_url = "wss://replace-me/ws/sensor-gateway"
client_cert_path = "/etc/cheeky-pony/client.crt"
client_key_path = "/etc/cheeky-pony/client.key"
ca_cert_path = "/etc/cheeky-pony/ca.crt"
manage_kismet = true
EOF
  chown "${APP_USER}:${APP_USER}" "${CONFIG_DIR}/sensor.toml"
  chmod 0640 "${CONFIG_DIR}/sensor.toml"
fi

python3 -m venv "${APP_ROOT}/venv"
"${APP_ROOT}/venv/bin/pip" install --upgrade pip
"${APP_ROOT}/venv/bin/pip" install /tmp/cheeky-pony-shared /tmp/cheeky-pony-sensor

systemctl daemon-reload
systemctl enable cheeky-pony-sensor.service
systemctl restart cheeky-pony-sensor.service
