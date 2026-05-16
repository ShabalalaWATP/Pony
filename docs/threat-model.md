# Threat Model v0.1

Method: STRIDE per major component.

## Backend API

- Spoofing: JWT cookies are signed, HTTP-only, SameSite=strict, and state-changing browser flows require CSRF headers.
- Tampering: Pydantic v2 validates inputs; repository boundaries own persistence writes.
- Repudiation: active gates and state-changing admin flows append audit entries.
- Information disclosure: strict CORS and CSP headers reduce browser exfiltration paths.
- Denial of service: auth endpoints are rate-limited in-process for development and designed for Redis-backed limits.
- Elevation of privilege: admin actions require admin role plus a verified TOTP session.

## Sensor Gateway

- Spoofing: sensor WebSocket accepts only authenticated sensor identity from the mTLS termination layer.
- Tampering: event payloads are normalized into shared Pydantic models before persistence.
- Repudiation: sensor commands and active rejections are auditable.
- Information disclosure: Pi-to-PC link is intended for Tailscale and mTLS.
- Denial of service: reconnect logic uses exponential backoff with jitter.
- Elevation of privilege: local commands use argument lists and narrowly scoped subprocess wrappers.

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

Active modules are not implemented in milestones 0-2. The gate service is present so future attack surface must pass lab mode, acknowledgement, and engagement allow-list checks before execution.
