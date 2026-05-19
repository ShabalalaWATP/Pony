# Cheeky Pony

Cheeky Pony is a self-hosted WiFi monitoring and gated lab platform. A Raspberry Pi
sensor streams normalized WiFi telemetry to a FastAPI backend, and the React operator
console consumes the backend through OpenAPI-generated types and authenticated
WebSockets.

> **Authorized testing only.** Cheeky Pony is built for networks you own or have
> written permission to assess. Active modules are default-deny and require a typed
> legal acknowledgement on file — see `Security Posture` below and
> [`SECURITY.md`](SECURITY.md).

## Documentation map

| What | Where |
| --- | --- |
| Day-to-day operator usage (auth, users, sensors, lab, alerts, reports) | [`docs/operator-guide.md`](docs/operator-guide.md) |
| System topology, data flow, lab gates, login sequence (with diagrams) | [`docs/architecture.md`](docs/architecture.md) |
| STRIDE threat model per component | [`docs/threat-model.md`](docs/threat-model.md) |
| Frontend design spec (tokens, motion, components) | [`docs/frontend-design.md`](docs/frontend-design.md) |
| Local development runbook | [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md) |
| Backend load-testing runbook | [`docs/runbooks/load-testing.md`](docs/runbooks/load-testing.md) |
| Architecture Decision Records | [`docs/adr/`](docs/adr) |
| Release-history / per-PR log | [`CHANGELOG.md`](CHANGELOG.md) |
| Vulnerability reporting | [`SECURITY.md`](SECURITY.md) |

## Contributing

Engineering standards — SOLID, file/function size caps, strict typing,
security non-negotiables, audit-on-every-state-change, ADRs for non-obvious
decisions — live in the standing agent briefs. Read whichever applies to the
code you're touching **before** you start:

- [`AGENTS.md`](AGENTS.md) — backend, sensor-agent, infra, CI/CD, docs
- [`CLAUDE.md`](CLAUDE.md) — frontend (`apps/frontend/`)

Both briefs document ownership boundaries, the OpenAPI-driven coordination
contract between backend and frontend, the per-PR Definition of Done, and
where to look for context. Re-read them on every session.

## Current Status

The repository contains the full passive-monitoring path plus the backend command
plane and every operator-facing route the frontend exposes:

- monorepo guardrails, GitHub Actions quality/security gates (lint, test, SAST,
  SCA, DAST, CodeQL, gitleaks, AI review), compose stacks, ADRs, threat model,
  and runbooks
- Raspberry Pi `sensor-agent` v1 for passive Kismet ingestion, backend WebSocket
  streaming, command dispatch, reconnects, and local health endpoints
- FastAPI backend with cookie auth + CSRF + TOTP step-up, sensors register /
  revoke / lifecycle, APs, clients, events, alerts + alert rules, audit (no
  delete route), authorized-operator acknowledgements, engagements + allow-lists
  + single-engagement read, admin user listing and mutation, reporting + signed
  download URLs, operator/sensor WebSockets, and synthetic demo data streaming via
  `make seed-demo-stream`
- manual Locust load profile for backend REST and operator WebSocket paths via
  `make load-test`
- active lab command endpoints for `rogue-ap`, `deauth`, `evil-twin`,
  `captive-portal`, and `mitm`, with default-deny gates (see
  [`docs/architecture.md`](docs/architecture.md#lab-gate-stack) for the gate
  diagram) and audit on both refusals and accepted commands
- React frontend: design system, shell, auth + TOTP step-up, overview, sensors
  (register + revoke + lifecycle), networks + devices (with detail drawers
  fetched on deep-link), events, alerts inbox + rule editor, lab + engagement
  panels, engagement detail page, reporting surfaces, audit log view, admin
  users management, and a coordinated frontend security hardening pass

Backend/frontend coordination is through `packages/shared-types/`,
`packages/shared-types/schemas/openapi.json`, and the committed generated frontend
types in `apps/frontend/src/services/api/openapi.d.ts`. See
[`CHANGELOG.md`](CHANGELOG.md) for the per-PR log.

## Local Setup

```bash
make bootstrap
make lint
make test
```

Start the compose smoke stack:

```bash
make up
```

`make up` starts MongoDB, Redis, the backend on `http://localhost:8000`, and a
hardened nginx frontend placeholder on `http://localhost:5173`. For real frontend
development, start only the backend dependencies and backend service, then run Vite:

```bash
docker compose -f infra/docker-compose.yml up --build mongo redis backend
pnpm --filter @cheeky-pony/frontend dev
```

If `uv` or `pnpm` are not installed, install them first or use Python directly:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e "packages/shared-types[dev]" -e "apps/backend[dev]" -e "apps/sensor-agent[dev]"
```

Run the backend load profile against a local stack:

```bash
CHEEKY_PONY_LOAD_EMAIL=admin@example.com \
CHEEKY_PONY_LOAD_PASSWORD='replace-with-local-password' \
CHEEKY_PONY_LOAD_TOTP_SECRET='replace-with-local-secret' \
make load-test
```

See [`docs/runbooks/load-testing.md`](docs/runbooks/load-testing.md) for the
full setup, session-cookie shortcut, and baseline recording process.

## Contracts

Regenerate shared Python/OpenAPI contracts after backend schema changes:

```bash
make openapi
```

Regenerate frontend API and route artifacts after OpenAPI or route changes:

```bash
pnpm --filter @cheeky-pony/frontend run generate:api-types
pnpm --filter @cheeky-pony/frontend run generate:routes
```

CI fails if generated shared schemas, frontend API types, or frontend route trees are
not committed.

## Security Posture

Active operations are deliberately blocked unless every gate is true:

- backend `CHEEKY_PONY_LAB_MODE=true`
- an `authorized_operator` acknowledgement exists
- the current operator is an admin
- the current operator has a recent TOTP verification
- the request references an active engagement
- the target is in that engagement allow-list

Missing gates return `403` with a structured reason and write an audit entry. Audit
records are append-only and no delete route is exposed. Production-like
environments reject known development secrets at startup.
