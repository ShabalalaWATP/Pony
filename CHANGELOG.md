# Changelog

All notable PRs are recorded here. Entries are grouped by milestone or theme rather
than by date because work lands as a fan-out of parallel PRs.

## Unreleased

### Documentation — Hermes Pi onboarding state

- New runbook `docs/runbooks/pi-hermes-onboarding.md` captures the OS-layer
  setup of the first physical Cheeky Pony sensor (Hermes): aircrack-ng
  RTL8812AU DKMS driver, channel-hopper systemd service, Kismet from upstream
  repo, bettercap from apt, Tailscale auth, NetworkManager wlan1 isolation.
  Reproducible end-to-end with shell snippets.
- New ADR-0022 records the driver / hopper / capture-tool choices and the
  Trixie-specific Kismet apt-repo decision.
- `docs/operator-guide.md` cross-links the new runbook before the "Registering
  a new Pi" section so first-time operators do the OS layer before they touch
  the dashboard's sensor registration flow.
- Master-plan status: M0-M8 + Phase 1-3 are complete. M9 (hardening) is
  Codex's active queue. The remaining M1-completion gap is deploying the
  sensor-agent to Hermes — code, install script, and systemd unit all exist,
  but no cert pair has been issued for this Pi yet. Tracked in the runbook's
  "What's next" section.

### Security hardening — PCAP uploads and LLM worker kill switch

- Added a pre-body PCAP upload guard so unauthenticated, unauthorized, CSRF-less,
  inactive-engagement, or over-limit multipart uploads are rejected before temp
  file spooling.
- Wired Mongo LLM runtime flags into production arq workers and made missing
  runtime-flag context fail closed so the runtime kill switch applies to
  background insight generation.

### Backend Phase 3E — LLM admin controls and hardening (#70)

- Added admin-only LLM usage telemetry, admin/TOTP/CSRF-protected insight
  refresh, and a typed-confirm runtime kill switch that can disable LLM dispatch
  without overriding the hard `LLM_ENABLED=false` opt-in.
- Added demo seeder integration that pre-generates a few alert-context insights
  in dev only when LLM insights are explicitly enabled.

### Backend Phase 3D — LLM PCAP finding (#69)

- Added authenticated, on-demand PCAP-finding insight reads with immutable
  cache TTL and structured engagement/finding context.
- Excluded raw `tshark` output, raw EAPOL bytes, and PMKID material from LLM
  prompt contexts even when lab-mode PCAP APIs can return that evidence.

### Backend Phase 3C — LLM AP description (#68)

- Added authenticated, on-demand AP-description insight reads with 24-hour
  cache TTL, signal summaries, local label/anomaly context, and associated
  client aggregate context.
- Split the shared LLM generation runtime out of the service orchestrator so
  new named insight kinds reuse the same budget, cache, validation, and audit
  path without growing a large service file.

### Backend Phase 3B — LLM engagement summary (#67)

- Added authenticated engagement-summary insight reads with one-hour cache TTL,
  aggregate event/alert/PCAP finding context, and validated model output.
- Added engagement-end background generation that runs once per newly ended
  engagement without blocking the existing end flow.

### Backend Phase 3A — LLM insight foundation (#66)

- Added the opt-in OpenAI-compatible LLM insight pipeline with prompt redaction,
  versioned templates, output validation, Mongo-backed cache, monthly budget
  ledger, and hashed audit metadata.
- Added authenticated alert-context insight reads and alert-engine worker
  generation hooks while keeping free-form prompts out of the API.

### Backend Phase 2E — PCAP demo and report integration (#65)

- Added demo PCAP assets to `make seed-demo`, persisted through validation,
  GridFS, and the curated analyzer path with idempotent cleanup.
- Added capture finding summaries to engagement reports without exposing raw
  tshark output or packet bytes.

### Backend Phase 2D — PCAP network findings (#64)

- Added DNS, TLS SNI, and DHCP structured PCAP findings with pre-persistence
  internal-hostname redaction.
- Added local DHCP vendor enrichment from Client records and the bundled OUI
  table, with no external lookups.

### Backend Phase 2C — PCAP WiFi findings (#63)

- Added EAPOL handshake, beacon summary, and probe-response anomaly findings to
  the sandboxed PCAP analyzer.
- Added LAB_MODE-gated PMKID/raw EAPOL response redaction so normal environments
  expose handshake metadata without cracking material.

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
