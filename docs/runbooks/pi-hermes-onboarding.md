# Pi Onboarding Runbook (Hermes)

Reproducible record of how the first physical Cheeky Pony sensor — a Raspberry Pi
named **Hermes** — was brought from blank-image to monitor-mode-ready and joined to
the operator's tailnet. Subsequent sensor deployments should follow the same flow.

> **Scope.** This runbook covers the *operating-system + tooling* layer: putting the
> WiFi adapter into monitor mode, installing capture tools, and giving the Pi a
> stable address on the tailnet. It does **not** install or configure the
> Cheeky Pony sensor-agent itself — that step depends on backend cert issuance
> and is tracked separately as **M1 — sensor-agent deployment** (see
> "What's next" at the bottom).

## Current state of Hermes (2026-05-26)

| Layer | State |
|---|---|
| Hostname | `hermes` (advertised via mDNS as `hermes.local`) |
| LAN IP (Vodafone WiFi) | `192.168.1.111/24` |
| Tailnet IP | `100.116.150.111` (on `shabalalawatp.github` tailnet) |
| OS | Debian GNU/Linux 13 (trixie) / Raspberry Pi OS, kernel `6.12.75+rpt-rpi-v8` on aarch64 |
| SSH user | `pi` (default password — **needs replacement**; see "Outstanding security follow-ups") |
| SSH host key (ed25519) | `SHA256:zNmqKZU0z5mQ0/XD369FjqdvJRLyO8HGreMoywrEwLs` |
| Built-in WiFi | `wlan0` 88:a2:9e:bf:b5:43 — managed by NetworkManager, carries the operator's SSH lifeline |
| Alfa adapter | AWUS036ACH (Realtek RTL8812AU, USB ID `0bda:0811`), exposes as `wlan1` MAC `00:c0:ca:b9:aa:1a` |
| Alfa mode | `monitor`; Kismet owns channel hopping on `wlan1mon` during normal sensor operation |
| Sensor-agent | **NOT YET DEPLOYED**; the `apps/sensor-agent/` package + `infra/pi/install.sh` are ready to run but no cert pair has been issued for this Pi yet |

## Stage-by-stage replay

These are the exact steps that were applied. Each stage is independently re-runnable;
if a stage already succeeded it's a no-op.

### Stage 0 — Reachability + SSH

The Pi was reimaged with Raspberry Pi OS and joined to the operator's Vodafone WiFi
during the imager step (SSH enabled, hostname `hermes`, user `pi`). From the
operator's Windows host on the same `/24`:

```powershell
# mDNS finds it without configuration
PS> [System.Net.Dns]::GetHostAddresses("hermes.local")
# → 192.168.1.111

# Confirm SSH listening + grab the host key for verification
ssh-keyscan -T 5 -t ed25519 192.168.1.111
# expect SHA256:zNmqKZU0z5mQ0/XD369FjqdvJRLyO8HGreMoywrEwLs

# Either OpenSSH or plink works. plink is convenient for automation:
plink -ssh -hostkey "SHA256:zNmqKZU0z5mQ0/XD369FjqdvJRLyO8HGreMoywrEwLs" `
      -pw "<password>" pi@192.168.1.111 "uname -a"
```

### Stage 1 — Driver: Alfa AWUS036ACH into monitor mode

The kernel's in-tree `rtw88` driver does not bind reliably to the RTL8812AU
(it picked up the device's USB descriptor but never created a `wlan*` interface).
The fix is the aircrack-ng community driver, built via DKMS so it rebuilds on
every kernel upgrade.

```bash
# Build prerequisites (kernel headers are already on Pi OS images)
sudo apt-get install -y --no-install-recommends \
  git dkms iw aircrack-ng bc libelf-dev

# Clone + install via the project's standard DKMS target
git clone --depth 1 https://github.com/aircrack-ng/rtl8812au.git ~/rtl8812au
cd ~/rtl8812au && sudo make dkms_install

# Verify the module is registered
sudo dkms status
# 8812au/5.6.4.2_35491.20191025, 6.12.75+rpt-rpi-v8, aarch64: installed
```

After `modprobe 88XXau` (or a reboot) the device appears as `wlan1`.

### Stage 2 — Fence NetworkManager off `wlan1`

NetworkManager scans + auto-connects on any WiFi interface it sees. Once the Alfa
came up as `wlan1`, NM would have yanked it out of monitor mode within seconds.
Tell NM to leave it alone — `wlan0` (the SSH lifeline) stays managed:

```bash
sudo tee /etc/NetworkManager/conf.d/99-cheeky-pony-wlan1.conf <<'EOF'
# Cheeky Pony: keep NetworkManager away from the Alfa monitor adapter.
# Without this, NM will scan/connect on wlan1 the moment it appears and
# either change channels mid-capture or kick it out of monitor mode.
# wlan0 (built-in WiFi) remains NM-managed for the SSH lifeline.
[keyfile]
unmanaged-devices=interface-name:wlan1;mac:*-rtl-monitor
EOF
sudo nmcli general reload
```

`nmcli device status` should then show `wlan1 ... unmanaged`.

### Stage 3 — Channel hopper

Monitor mode on a single channel only captures ~1/11 of 2.4 GHz traffic (and
nothing on 5 GHz). The channel-hopper service cycles `wlan1` across the common
non-DFS channels so a passive capture sees the whole spectrum.

```bash
# Script — cycles 2.4 GHz non-overlapping + UNII-1 + UNII-3
sudo tee /usr/local/bin/cheeky-pony-channel-hop >/dev/null <<'SCRIPT'
#!/bin/bash
set -u
IFACE=${IFACE:-wlan1}
CHANNELS=(1 6 11 36 40 44 48 149 153 157 161)
DWELL=${DWELL:-0.4}
trap "exit 0" SIGTERM SIGINT
while true; do
  for ch in "${CHANNELS[@]}"; do
    iw dev "$IFACE" set channel "$ch" 2>/dev/null || true
    sleep "$DWELL"
  done
done
SCRIPT
sudo chmod 755 /usr/local/bin/cheeky-pony-channel-hop

# systemd unit — also re-applies monitor mode at every start, so monitor
# mode persists across reboot for free.
sudo tee /etc/systemd/system/cheeky-pony-channel-hop.service >/dev/null <<'UNIT'
[Unit]
Description=Cheeky Pony channel hopper for wlan1 (monitor mode)
Wants=sys-subsystem-net-devices-wlan1.device
After=sys-subsystem-net-devices-wlan1.device

[Service]
Type=simple
ExecStartPre=/usr/sbin/ip link set wlan1 down
ExecStartPre=/usr/sbin/iw dev wlan1 set type monitor
ExecStartPre=/usr/sbin/ip link set wlan1 up
ExecStart=/usr/local/bin/cheeky-pony-channel-hop
Restart=on-failure
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now cheeky-pony-channel-hop.service
```

> ⚠ **Superseded for normal operation.** Stage 6 makes Kismet the channel
> authority for Hermes. Keep this standalone hopper on disk as a fallback for
> ad-hoc `tcpdump` sweeps, but do not leave it enabled while Kismet is running.

### Stage 4 — Kismet + bettercap

Trixie's default apt doesn't carry Kismet, so we use the upstream Kismet apt repo
(`kismetwireless.net`) which publishes a signed trixie distribution. bettercap is
in Debian's standard repo.

```bash
# Kismet — official signed apt repo for trixie
sudo install -d -m 0755 /etc/apt/keyrings
wget -qO - https://www.kismetwireless.net/repos/kismet-release.gpg.key |
  sudo gpg --dearmor --yes -o /etc/apt/keyrings/kismet-release.gpg
echo "deb [signed-by=/etc/apt/keyrings/kismet-release.gpg] https://www.kismetwireless.net/repos/apt/release/trixie trixie main" |
  sudo tee /etc/apt/sources.list.d/kismet.list
sudo apt-get update

# Pre-seed kismet's debconf so setuid helpers + kismet group are configured non-interactively
sudo debconf-set-selections <<'DEBCONF'
kismet-capture-common kismet-capture-common/install-users boolean true
kismet-capture-common kismet-capture-common/users string pi
DEBCONF

# Install both, do not auto-start (sensor-agent will own service lifecycle)
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  kismet bettercap bettercap-caplets
sudo systemctl disable --now kismet.service 2>/dev/null || true
sudo systemctl disable --now bettercap.service 2>/dev/null || true

# Operator → kismet group so capture-without-root works after next login
sudo usermod -aG kismet pi
```

Versions installed at time of writing:

- **Kismet 2025.09.0** (upstream stable, latest at install time)
- **bettercap 2.41.x** (Debian trixie main)

### Stage 5 — Tailscale

Tailscale gives the Pi a stable `100.x.x.x` private address reachable from any
operator workstation on the same tailnet, regardless of which physical network
the Pi happens to be on. This is the link the sensor-agent will use to reach the
backend (ADR-0003).

```bash
# Official install script (adds signed apt repo + installs tailscaled)
curl -fsSL https://tailscale.com/install.sh -o /tmp/tailscale-install.sh
sudo bash /tmp/tailscale-install.sh

# Bring the device up — prints a one-time auth URL on stdout
sudo tailscale up --hostname=hermes
# → "To authenticate, visit: https://login.tailscale.com/a/<token>"

# Operator visits the URL in their browser, signs in to the tailnet, approves
# the device. `tailscale up` returns on its own once approved.

# After auth:
tailscale ip -4    # → 100.116.150.111  (varies per tailnet)
tailscale status   # → hermes + alex-hp-zbook (and any other tailnet peers)
```

> The operator's Windows host (`alex-hp-zbook`) is also on the tailnet at
> `100.74.122.35`. That's the address the sensor-agent's `backend_ws_url` will
> point at once the backend runs there in production-ish mode.

### Stage 6 — Switch channel authority to Kismet

Hermes originally used the standalone channel-hopper systemd unit while we were
validating monitor mode with `tcpdump`. The deployed sensor path is different:
`infra/pi/kismet_site.conf` now declares `wlan1mon` as a Kismet source with
`hop=true`, so Kismet owns channel rotation when the sensor-agent starts it.

Disable the standalone hopper before deploying the sensor bundle:

```bash
sudo systemctl disable --now cheeky-pony-channel-hop.service
# If an older local note created this shorter alias, disable it too.
sudo systemctl disable --now cheeky-pony-hopper.service 2>/dev/null || true
```

The hopper script and unit can stay on disk as a fallback, but they are not
enabled by default. After rerunning `infra/pi/install.sh`, verify Kismet sees the
configured source and that both raw capture and Kismet observe traffic:

```bash
grep '^source=wlan1mon:name=alfa-awus036ach' /etc/kismet/kismet_site.conf
kismet_cli -- show-sources
sudo tcpdump -i wlan1mon -c 10
curl -s http://127.0.0.1:2501/devices/views/all_devices/devices.json | head
```

## Verifying monitor mode is actually working

The driver will sometimes report `type monitor` while silently delivering zero
frames (a class of Realtek bug). To prove the chain end-to-end:

```bash
sudo apt-get install -y tcpdump   # one-time
sudo systemctl stop cheeky-pony-channel-hop.service 2>/dev/null || true
sudo iw dev wlan1mon set channel 1

# Capture 4s of 802.11 management frames
sudo timeout 4 tcpdump -i wlan1mon -nn -e -c 25 'type mgt subtype beacon'

# Expect 20+ beacons from neighbouring APs (SSIDs like BT-xxxxxx,
# Sky_xxxx, EE WiFi, etc., RSSI -50 to -75 dBm depending on geometry)

# Leave the standalone hopper stopped; Kismet owns hopping during sensor runs.
```

If `tcpdump` reports zero beacons but `iw dev wlan1mon info` reports `type monitor`,
the driver bound but the device is mis-keyed for monitor capture — `dmesg | tail`
will usually show the `88XXau` driver complaining; rebooting once after the
DKMS install almost always resolves it.

## What's next — M1 sensor-agent deployment

Hermes' *operating system* is now ready to host a Cheeky Pony sensor. What's
still missing is the **sensor-agent application** itself talking to the backend.
The pieces that exist but aren't wired together:

| Component | Where it lives | State |
|---|---|---|
| Sensor-agent Python package | `apps/sensor-agent/` | Code complete (Kismet driver, mTLS WS client, normalisers, command dispatcher) |
| Per-Pi cert + key pair | issued by backend's `POST /api/v1/sensors` | **Not yet generated for Hermes** |
| Pi install script | `infra/pi/install.sh` | Idempotent installer, drops the systemd unit + venv |
| Sensor systemd unit | `infra/pi/cheeky-pony-sensor.service` | Ready, expects `/etc/cheeky-pony/sensor.toml` |
| Kismet remote-capture profile | `infra/pi/kismet_site.conf` | Pre-configured with `wlan1mon` source + Kismet channel hopping |

The remaining work is:

1. **Backend side (Codex).** On the operator workstation, run `make up`, log in
   to the dashboard as admin, hit `POST /api/v1/sensors` to register Hermes →
   backend mints a CA-signed mTLS cert pair and returns it once (the existing
   register flow already enforces one-shot retrieval).
2. **Pi side (Codex / operator).** Copy the cert + key to
   `/etc/cheeky-pony/client.{crt,key,ca.crt}` on Hermes and paste the
   `sensor_toml` body returned by registration into
   `/etc/cheeky-pony/sensor.toml`. Run `infra/pi/install.sh` to register the
   systemd unit and start the agent.
3. **First-flight check.** Frontend `/sensors` should show Hermes as `live`
   within 30 s; `/networks` should start receiving real APs alongside the
   synthetic demo set within a minute.

## Outstanding security follow-ups

These were called out during the initial onboarding but are not yet fixed:

1. **Default `raspberry` password on the `pi` user.** Anyone on the operator's
   Vodafone LAN can SSH in. Replace with a strong password and add the
   operator's SSH public key to `~/.ssh/authorized_keys`, then disable
   password auth in `sshd_config`.
2. **`sudo` still accepts that password.** Same risk; same fix as #1.
3. **Standalone channel hopper runs as root.** Stage 6 disables it by default
   because Kismet now owns channel hopping. If we re-enable the fallback hopper
   for ad-hoc capture workflows, tighten it to `CAP_NET_ADMIN` or a narrow
   sudo rule limited to `iw dev wlan1mon set channel`.
4. **No firewall rules yet.** The Pi is exposed on the LAN; only Tailscale ACLs
   currently restrict who can reach it on the tailnet. Adding nftables to drop
   anything not from the tailnet or the operator's `/24` is a sensible next
   step.

## Mock data and the real sensor

Once the sensor-agent is connected and Hermes is streaming, real sensor
records and the synthetic demo dataset coexist in MongoDB. The schema's
`synthetic: bool` field distinguishes them:

- A fresh `make demo-seed` run still produces the same realistic-looking demo
  rows it produces today (set `synthetic=true`).
- Hermes' captures land in the same collections with `synthetic=false`.
- The dashboard currently does not filter by `synthetic`; both sources render
  side-by-side. If that becomes visually noisy, a future frontend slice can
  add a "demo data" toggle.

We do **not** delete the demo dataset when a real sensor connects — losing the
clean offline demo experience is worse than the cohabitation noise.
