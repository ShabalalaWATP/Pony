# Threat Model v0.3

Method: STRIDE per major component.

## Backend API

- Spoofing: JWT cookies and Bearer tokens are signed; state-changing API flows
  require CSRF headers when authenticated by either cookie or Bearer token.
- Tampering: Pydantic v2 validates inputs; repository boundaries own persistence writes, including AP geolocation fields.
- Repudiation: active gates and state-changing admin/auth flows append audit
  entries on success and refusal; logout records the actor id.
- Information disclosure: strict CORS and CSP headers reduce browser exfiltration paths; server-side AP coordinates are authenticated API data and must not be exposed on public routes.
- Denial of service: auth endpoints are rate-limited in-process for development and designed for Redis-backed limits.
- Elevation of privilege: first-admin bootstrap requires the one-time
  `CHEEKY_PONY_BOOTSTRAP_TOKEN`, and admin actions require admin role plus a
  verified TOTP session.

## Operator Realtime Channel

- Spoofing: operator WebSockets require a valid signed access-token cookie before accept.
- Tampering: outbound topic payloads are built from validated shared models before
  broadcast, including alert notifications and command results. The channel is
  currently server-fan-out only; any future client-pushed mutation must re-check
  Origin per message before dispatch.
- Repudiation: realtime delivery is derived from persisted event, device, sensor, alert, and command audit records.
- Information disclosure: broadcasts are limited to authenticated operators and inherit strict cookie/CORS posture; alert payloads carry entity references rather than raw capture material.
- Denial of service: disconnected sockets are dropped from the in-process broker after failed sends.
- Elevation of privilege: the channel does not accept operator commands; state changes remain on CSRF-protected HTTP endpoints.

## Alert Rules

- Spoofing: alert rule mutations require an authenticated admin with a recent TOTP verification.
- Tampering: predicates are constrained to the v1 JSON shape and are evaluated against normalized event models.
- Repudiation: rule create, update, delete, and alert acknowledgement operations append audit entries.
- Information disclosure: alert records expose severity and related entity identifiers only; predicate matches must not persist packet payloads or credentials.
- Denial of service: regex predicates are length-limited and invalid expressions fail closed without firing.
- Elevation of privilege: non-admin users can list and acknowledge alerts but cannot create, modify, or delete rules.

## Privileged User Mutation

- Spoofing: user listing and mutation require a signed access-token cookie for an admin with a recent TOTP verification.
- Tampering: `PATCH /api/v1/users/{id}` accepts only the enumerated `operator` and `admin` roles and rejects unknown role strings with `422`.
- Repudiation: every accepted user mutation and business-rule denial writes a `user.update` audit entry with sanitized requested changes.
- Information disclosure: user list and update responses return `UserPublic` only and never include password hashes, TOTP secrets, or refresh-token versions.
- Denial of service: user listing is bounded by the standard pagination contract and a maximum page size of 500.
- Elevation of privilege: the store boundary protects the last active admin from self-demotion while replacing roles or resetting TOTP state.

## Sensor Gateway

- Spoofing: sensor WebSocket accepts only authenticated sensor identity from the mTLS termination layer.
- Tampering: event payloads and command-result envelopes are normalized before persistence or operator fan-out; inbound frames with `synthetic: true` are rejected and audited.
- Repudiation: sensor commands write queue and completion audit entries linked by command id.
- Information disclosure: Pi-to-PC link is intended for Tailscale and mTLS.
- Denial of service: reconnect logic uses exponential backoff with jitter.
- Elevation of privilege: local commands use argument lists and narrowly scoped subprocess wrappers.

## Demo Data Seeder

- Spoofing: CLI seed and clean actions are attributed to the invoking actor id or `system:seed`.
- Tampering: the seeder refuses outside `CHEEKY_PONY_ENV=dev`, refuses while lab mode is live, and refuses when a non-synthetic sensor has checked in recently unless `--force` is supplied.
- Repudiation: seed and clean operations append `demo.seed.run` and `demo.seed.clean` audit entries.
- Information disclosure: synthetic MACs use the `02:00:` locally administered range and no real sensor identifiers are copied into the seeded dataset.
- Denial of service: seeded signal histories are capped at the same 200-sample repository boundary as real telemetry.
- Elevation of privilege: seeded records are metadata only; production read and lab-gating behavior does not trust the `synthetic` marker.

## Sensor Lifecycle Commands

- Spoofing: lifecycle command endpoints require an authenticated admin with recent TOTP and CSRF.
- Tampering: command bodies are Pydantic-validated and delivered as shared `SensorCommand` models over the mTLS sensor channel.
- Repudiation: every queued command and sensor completion result appends an audit entry; raw tool output is referenced by command id rather than stored in audit fields.
- Information disclosure: operator WebSocket command results expose outcome metadata only, not raw tool output.
- Denial of service: commands are queued in-process for disconnected sensors and disconnected WebSockets are removed after failed sends.
- Elevation of privilege: `set_channel` requires the sensor to advertise channel-control capability; Pi-side execution uses `create_subprocess_exec` argument lists.

## Engagement Management

- Spoofing: engagement list and allow-list reads require an authenticated session; mutations require admin, recent TOTP, and CSRF.
- Tampering: engagement and allow-list payloads are Pydantic-validated and stored through the repository boundary.
- Repudiation: engagement creation, resume, end, allow-list add, and allow-list remove operations append audit entries.
- Information disclosure: allow-list reads expose only target kind and value to authenticated operators.
- Denial of service: list endpoints are bounded by standard pagination limits.
- Elevation of privilege: resuming an engagement is refused when another engagement is already active.

## MongoDB and Redis

- Spoofing: services are isolated in compose networks and configured through environment variables.
- Tampering: audit logs are append-only at API level and no delete route exists.
- Repudiation: operator identity is recorded for privileged flows.
- Information disclosure: credentials are environment-sourced only.
- Denial of service: indices cover primary query paths.
- Elevation of privilege: production deployments must use per-service credentials and host firewalling.

## Raspberry Pi Tooling

- Spoofing: Kismet and bettercap APIs bind to localhost.
- Tampering: parser tests cover malformed telemetry.
- Repudiation: sensor command outcomes are reported to the backend.
- Information disclosure: raw tool output is referenced rather than blindly exposed.
- Denial of service: process lifecycle is isolated to the unprivileged `cheekypony` user where possible.
- Elevation of privilege: installer creates a dedicated user and systemd unit.

## Active Modules

- Spoofing: lab start and stop routes require an authenticated admin with a recent TOTP verification and CSRF; sensor delivery still rides the authenticated mTLS sensor WebSocket.
- Tampering: every start request is validated by Pydantic, module names are enumerated, targets are typed, and commands are sent as shared `SensorCommand` models rather than shell strings.
- Repudiation: every success, refusal, stop request, and sensor command result writes an audit entry with actor, target, timestamps, outcome, and a command-scoped raw-output reference.
- Information disclosure: sensitive parameter keys such as credentials, tokens, secrets, keys, and handshakes are redacted before audit storage; plaintext captured credentials must not be accepted by this command plane.
- Denial of service: active commands are tracked in the broker and removed on stop, failed start acknowledgement, or engagement end; ending an engagement cancels scoped active commands.
- Elevation of privilege: the gate stack fails closed unless `LAB_MODE=true`, an `authorized_operator` acknowledgement exists, the requested engagement is active, and the target is present in that engagement allow-list. The read-only lab status probe exposes gate state but never bypasses start/stop authorization.

## Reporting and Export

- Spoofing: report creation, status, and download routes require an authenticated session; downloads also require a signed per-report token.
- Tampering: report requests are Pydantic-validated, including format and time range, before persistence or worker generation.
- Repudiation: report creation appends an audit entry with actor, engagement, report id, requested format, and time window.
- Information disclosure: download tokens are HMAC-signed and short-lived; audit exports omit raw tool output references and generated artifacts stay behind authenticated routes.
- Denial of service: v1 report generation caps event, alert, and audit source reads to bounded pages while async worker wiring is introduced.
- Elevation of privilege: reports are scoped to an existing engagement and cannot be fetched by id without matching the engagement path.
