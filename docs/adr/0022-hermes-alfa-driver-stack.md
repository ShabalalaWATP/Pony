# ADR 0022: Hermes Sensor — Alfa Driver, Kismet Channel Control, and Capture-Tool Stack

## Status

Accepted

## Context

We needed to put the first physical Cheeky Pony sensor (a Raspberry Pi 5 named
**Hermes**) onto the air with a USB WiFi adapter capable of monitor-mode capture
+ frame injection across 2.4 GHz and 5 GHz. The adapter is an
**Alfa AWUS036ACH** built around the **Realtek RTL8812AU** chipset.

Three layered choices needed pinning down before we could move on to deploying
the sensor-agent application:

1. Which **driver** to use for the RTL8812AU.
2. Which **channel-selection strategy** to run by default.
3. Which **capture tools** to install, and how to manage their lifecycle.

This ADR records what we picked and why. Operational replay lives in the
[`docs/runbooks/pi-hermes-onboarding.md`](../runbooks/pi-hermes-onboarding.md)
runbook.

## Decisions

### 1. Driver — `aircrack-ng/rtl8812au` via DKMS

The mainline kernel's `rtw88` driver recognises the RTL8812AU's USB ID
(`0bda:0811`) but does **not** create a `wlan*` interface — monitor-mode +
injection support is incomplete in tree. Two real options:

- **`aircrack-ng/rtl8812au`** — community fork maintained by the aircrack-ng
  team, packaged with a DKMS target. Supports monitor mode + injection on the
  full RTL88X2AU family.
- **`morrownr/8812au-20210820`** — alternative community fork; similar quality
  but smaller maintainer base.

We chose **`aircrack-ng/rtl8812au`** because:

- It's the canonical fork the aircrack-ng project itself ships with — pcap
  evidence we produce via this driver is interpretable by every tool in the
  aircrack-ng suite without surprises.
- The `make dkms_install` target rebuilds automatically against each new kernel
  via DKMS, eliminating the silent-failure-after-kernel-update class of bug.
- Installs cleanly on Debian/Trixie + Pi OS without patching.

Module name installed: `88XXau`. Currently pinned to driver version
`5.6.4.2_35491.20191025` (the project's most recent tag at install time).

### 2. Channel selection — Kismet-owned hopping

Monitor mode locked to a single channel sees ~9% of 2.4 GHz traffic and 0% of
5 GHz. Three options for channel control:

- **Single static channel** — simplest, useful for targeted captures but
  useless for situational-awareness sweeps. Rejected as default.
- **Kismet-driven hopping** — Kismet's own channel control. The right answer
  for dashboard streaming because the sensor-agent starts and supervises Kismet.
- **Independent channel-hopper service** — a tiny systemd unit cycling `wlan1`
  across the operator-relevant channels. Useful for ad-hoc `tcpdump` sweeps,
  but conflicts with Kismet's source lifecycle.

We initially used the independent hopper to validate the Alfa driver. Once
Hermes moved toward first dashboard streaming, we switched the default to
**Kismet-owned hopping** via `infra/pi/kismet_site.conf`:

```ini
source=wlan1mon:name=alfa-awus036ach,hop=true,channel_hop_speed=5/sec,channels="1,6,11"
```

The standalone hopper remains on disk as a fallback, but it is disabled by
default and must not run at the same time as Kismet.

Default Kismet channel set: `1, 6, 11` — the 2.4 GHz non-overlapping triplet.
The older standalone fallback still knows the UNII-1 and UNII-3 channels for
manual sweeps. **DFS channels are deliberately omitted** so the radio isn't
blocked listening for radar avoidance silence during channel dwell.

Kismet hop speed is `5/sec`. The fallback standalone hopper uses a 400 ms dwell
for manual sweeps; beacons go out every ~100 ms, so that dwell catches 3-4
beacon intervals per channel.

### 3. Capture tools — Kismet from upstream, bettercap from apt

**Kismet:** Trixie's default apt repo doesn't currently carry the `kismet`
package. Two options:

- Build from source (slow, breaks on every kernel/library update).
- **Use the upstream Kismet apt repo (`kismetwireless.net`)** — they publish
  a signed apt distribution for trixie at
  `https://www.kismetwireless.net/repos/apt/release/trixie`.

We use the upstream repo. The key is dearmored into
`/etc/apt/keyrings/kismet-release.gpg` and the source pinned via
`signed-by=` so unsigned tampering is detected. Version installed:
`2025.09.0`.

Kismet's debconf is pre-seeded so the setuid capture helpers are installed
and the `pi` user is added to the `kismet` group — capture-without-root
works after the user's next login. The systemd service `kismet.service` is
**disabled and not started** at install time; the sensor-agent will own its
lifecycle.

**bettercap:** Available directly from Debian's standard apt as `bettercap` +
`bettercap-caplets`. No upstream repo needed. Service likewise disabled at
install time.

### 4. NetworkManager isolation for `wlan1`

The built-in `wlan0` is the operator's SSH lifeline and must stay
NetworkManager-managed. The Alfa `wlan1` must be unmanaged or NM will scan
+ auto-connect on it, breaking monitor mode within seconds.

We drop a config snippet at
`/etc/NetworkManager/conf.d/99-cheeky-pony-wlan1.conf`:

```ini
[keyfile]
unmanaged-devices=interface-name:wlan1;mac:*-rtl-monitor
```

Applied via `nmcli general reload`. The MAC pattern is a future-proof guard
for additional Realtek monitor adapters under a documented manual prefix
(operators can rename other monitor adapters' MAC OUI vendor field via udev
if they want NM hands-off automatically without per-interface config).

## Consequences

- DKMS rebuilds the driver automatically on kernel updates — no manual
  re-install after `apt full-upgrade`.
- Kismet is the default channel authority for dashboard streaming. The
  standalone hopper is retained only as an ad-hoc fallback and should be
  disabled during normal sensor-agent operation.
- Operators on the Vodafone LAN can still reach the Pi via SSH; tighter
  network isolation (Tailscale-only SSH) is a future hardening step listed
  in the runbook's "Outstanding security follow-ups".
- The decision NOT to delete the synthetic demo dataset when a real sensor
  comes online means the dashboard renders both data sources simultaneously.
  If this becomes visually noisy a future frontend slice can add a `synthetic`
  toggle (recorded in the runbook).

## Re-review trigger

Revisit this ADR if:

- Realtek or kernel maintainers ever ship in-tree RTL8812AU monitor support
  that Just Works (would let us drop the DKMS dependency).
- We add a second adapter family (e.g. MediaTek MT7612U on the Alfa
  AWUS036ACM) — that's a different driver and may want a different default
  channel set.
- Kismet's apt repo for trixie disappears or drifts behind the project's
  releases.
