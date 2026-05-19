# Changelog

All notable PRs are recorded here. Entries are grouped by milestone or theme rather
than by date because work lands as a fan-out of parallel PRs.

## Unreleased

### Backend stage 9c slice B — SBOM signing

- Narrowed release image publishing to the backend image and added cosign signing
  plus verification for the generated SPDX SBOM.

### Backend stage 9c slice A — demo stream mode

- Added `seed_demo --stream` and `make seed-demo-stream` for dev-only synthetic
  operator WebSocket topics with guarded execution and start/stop audit entries.
- Added a Mongo-backed transient demo stream relay so the standalone CLI reaches
  the backend's in-process operator broker without introducing a new HTTP surface.

### Security audit follow-up

- Hardened auth, sensor admin, engagement, report, alert, and validation refusal
  paths so success and denial outcomes are audit-visible.
- Added first-admin bootstrap token enforcement, stricter auth throttling, Bearer
  CSRF coverage, CORS wildcard rejection, and sensor-agent interface validation.
- Restricted report exports to admin + recent TOTP, bound sensor command results
  to the target sensor, and made disabled-account checks consistent across auth
  refresh, registration, and operator WebSocket paths.

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
