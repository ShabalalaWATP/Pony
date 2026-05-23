# Changelog

All notable PRs are recorded here. Entries are grouped by milestone or theme rather
than by date because work lands as a fan-out of parallel PRs.

## Unreleased

### Backend Phase 2B — PCAP tshark foundation (#62)

- Added queued PCAP analysis with sandboxed `tshark`, structured protocol
  hierarchy, conversation, and deauthentication-burst findings.
- Added analysis status and findings endpoints, worker integration, startup
  tshark version checks, and CI/backend image tshark installation.

### Backend Phase 2A — PCAP ingest and storage (#61)

- Added engagement-scoped PCAP upload, metadata list/read, and typed-confirm
  deletion backed by GridFS.
- Added streaming PCAP magic/size validation and upload/delete audit entries.
- Hardened the release workflow cosign signing step so Semgrep no longer sees
  direct GitHub-context interpolation in a shell command.

### Backend Phase 1E — lab readiness endpoint (#60)

- Extended `GET /api/v1/lab/status` with response-only `ready` and `checks`
  fields so operators can see which lab gate is missing.
- Added audited unauthenticated refusals for lab-status reads.

### Backend Phase 1D — anomaly score and evil-twin candidates (#59)

- Added response-only AP `anomaly_score` and `anomaly_reasons` derived from
  local metadata, recent events, and same-SSID peers.
- Added authenticated `GET /api/v1/access_points/evil-twin-candidates` for
  same-SSID vendor mismatch review.

### Backend Phase 1C — local derived labels (#58)

- Added local AP/client classifiers and response-only `label` plus
  `label_confidence` fields for access point and device reads.
- Added `CHEEKY_PONY_LABEL_CONFIDENCE_THRESHOLD` to suppress weak labels.

### Backend Phase 1B — OUI vendor lookup (#57)

- Added a bundled Wireshark-derived OUI table, public `/api/v1/oui/{prefix}`
  lookup, and response-only AP/client `vendor_resolved` enrichment.

### Backend Phase 1A — sensor geo and realistic demo data (#56)

- Added nullable sensor coordinates, positioned synthetic sensors, realistic
  seeded SSIDs, hidden APs, client vendor names, and plausible probe histories.
- Pinned backend Starlette to 1.0.1 to clear PYSEC-2026-161 in SCA.

### Backend demo data geo

- Synthetic demo access points now include deterministic London-centered GPS
  coordinates on 45 of 50 APs so the map renders backend-provided markers on a
  fresh seed while retaining a small ungeolocated mixed-state sample.

### CI — unblock SCA: pin idna, accept disputed pyjwt advisory

- Pinned `idna==3.15` transitively in `apps/backend/requirements.lock`
  and `apps/sensor-agent/requirements.lock` to dodge
  GHSA-65pc-fj4g-8rjx (DoS in `idna.encode` on arbitrarily large
  inputs, fixed in 3.15). Real fix available, real bump preferred over
  an exception. Drop the explicit pin once httpx / email-validator /
  cryptography all require `idna>=3.15` themselves.
- `pip-audit` + `osv-scanner` now ignore PYSEC-2025-183 with an
  inline comment and a new top-level `osv-scanner.toml`. The advisory
  is disputed upstream and concerns key-length choice in the calling
  application; Cheeky Pony enforces ≥32-byte JWT secrets and rejects
  dev defaults in prod. Reasoning recorded in
  `docs/threat-model.md` under "Accepted advisory exceptions". Drop
  the ignore the moment upstream issues a fix.

### Security audit follow-up

- Hardened auth, sensor admin, engagement, report, alert, and validation refusal
  paths so success and denial outcomes are audit-visible.
- Added first-admin bootstrap token enforcement, stricter auth throttling, Bearer
  CSRF coverage, CORS wildcard rejection, and sensor-agent interface validation.

### Backend stage 9a — synthetic data and signal history

- Added a bounded `SignalsRepo` seam for AP/client signal samples with a 200-sample
  MongoDB cap and ADR-0008 documenting the later TimescaleDB migration point.
- Added synthetic demo seeding and cleanup commands, demo status reporting, and
  sensor-gateway rejection for inbound `synthetic: true` telemetry.

### Frontend stages 4–6 — final route wiring

- **#33** Stage 6 — `/engagements/$id` detail view (metadata, scope rules, live
  allow-list, lifecycle actions) and `/settings/users` admin view (role + TOTP
  reset drawer, self-demotion warning, structured 409 last-admin copy).
- **#31** Stage 5 — `/networks` and `/devices` detail drawers now fetch
  `GET /access_points/{bssid}` and `GET /devices/{mac}` so deep-links resolve
  even when the BSSID/MAC isn't on the visible list page. Seed → detail
  upgrade pattern keeps row-click instant.
- **#30** Stage 4 — `/sensors` register drawer (one-time cert reveal, private
  key masked until reveal, in-memory only) and typed-confirm revoke action in
  the sensor detail drawer.

### Backend stage 6 endpoints

- **#32** Single-engagement read at `GET /api/v1/engagements/{engagement_id}`
  for the new detail view's deep-link path.
- **#32** Admin-only user listing (`GET /api/v1/users`) and mutation
  (`PATCH /api/v1/users/{user_id}`) with role allow-list validation
  (`operator | admin`), TOTP reset support, last-admin protection (`409`),
  and audited denials for every refusal path.

### Frontend stages 1–3 — wire the dashboard against shipped endpoints

- **#29** Stage 3 — create-engagement drawer with scope-rules editor, blank-row
  drop, deep-link `?new=1` for shareable openings.
- **#28** Stage 2 — settings hub: About, System (gate-status + typed
  acknowledgement form), TOTP re-enrol flow.
- **#27** Stage 1 — audit log view: action-prefix filter chips, outcome
  tone-coded badges, 401/403 empty state.

### Brand pass

- **#26** Project glyph + wordmark wired into the app shell, login, and
  loading screen. No third-party trademarks anywhere.

### Hardening sweep

- **#23 / #24** Coordinated backend + frontend security hardening pass. CSP /
  CORP / COOP / Permissions / Referrer headers tightened; production secret
  detection at startup; navigation + download URL boundary checks
  (`safe-url.ts`) so the UI refuses anchors that aren't internal or
  same-origin `/api/...`.
- **#25** Post-hardening doc sync.
- **#22** Test-suite cleanup pass (timer leaks, unused stubs).
- **#21** Backend FastAPI startup hook modernised onto lifespan context
  manager.

### Earlier milestones

- **#19 / #20** Stage 8 reporting + export wired against the backend M4
  contract surfaces.
- Stages 0–8 of the original milestone plan (bootstrap, sensor agent v1,
  backend core, frontend shell, alerts, analysis pack, map + packet inspector,
  active lab modules, reporting) — see `git log` for the full path.
