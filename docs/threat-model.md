# Threat Model v0.3

Method: STRIDE per major component.

## Backend API

- Spoofing: JWT cookies are signed, HTTP-only, SameSite=strict, and state-changing browser flows require CSRF headers.
- Tampering: Pydantic v2 validates inputs; repository boundaries own persistence writes, including AP geolocation fields.
- Repudiation: active gates and state-changing admin flows append audit entries; logout records the actor id.
- Information disclosure: strict CORS and CSP headers reduce browser exfiltration paths; server-side AP coordinates are authenticated API data and must not be exposed on public routes.
- Denial of service: auth endpoints are rate-limited in-process for development and designed for Redis-backed limits.
- Elevation of privilege: admin actions require admin role plus a verified TOTP session.

## Operator Realtime Channel

- Spoofing: operator WebSockets require a valid signed access-token cookie before accept.
- Tampering: outbound topic payloads are built from validated shared models before broadcast, including alert notifications and command results.
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

## Sensor Gateway

- Spoofing: sensor WebSocket accepts only authenticated sensor identity from the mTLS termination layer.
- Tampering: event payloads and command-result envelopes are normalized before persistence or operator fan-out.
- Repudiation: sensor commands write queue and completion audit entries linked by command id.
- Information disclosure: Pi-to-PC link is intended for Tailscale and mTLS.
- Denial of service: reconnect logic uses exponential backoff with jitter.
- Elevation of privilege: local commands use argument lists and narrowly scoped subprocess wrappers.

## Sensor Lifecycle Commands

- Spoofing: lifecycle command endpoints require an authenticated admin with recent TOTP and CSRF.
- Tampering: command bodies are Pydantic-validated and delivered as shared `SensorCommand` models over the mTLS sensor channel.
- Repudiation: every queued command and sensor completion result appends an audit entry; raw tool output is referenced by command id rather than stored in audit fields.
- Information disclosure: operator WebSocket command results expose outcome metadata only, not raw tool output.
- Denial of service: commands are queued in-process for disconnected sensors and disconnected WebSockets are removed after failed sends.
- Elevation of privilege: `set_channel` requires the sensor to advertise channel-control capability; Pi-side execution uses `create_subprocess_exec` argument lists.

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
- Elevation of privilege: the gate stack fails closed unless `LAB_MODE=true`, an `authorized_operator` acknowledgement exists, the requested engagement is active, and the target is present in that engagement allow-list.

## Reporting and Export

- Spoofing: report creation, status, and download routes require an authenticated session; downloads also require a signed per-report token.
- Tampering: report requests are Pydantic-validated, including format and time range, before persistence or worker generation.
- Repudiation: report creation appends an audit entry with actor, engagement, report id, requested format, and time window.
- Information disclosure: download tokens are HMAC-signed and short-lived; audit exports omit raw tool output references and generated artifacts stay behind authenticated routes.
- Denial of service: v1 report generation caps event, alert, and audit source reads to bounded pages while async worker wiring is introduced.
- Elevation of privilege: reports are scoped to an existing engagement and cannot be fetched by id without matching the engagement path.
