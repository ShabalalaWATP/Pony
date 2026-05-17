# Cheeky Pony

Cheeky Pony is a self-hosted WiFi monitoring and gated lab platform. A Raspberry Pi
sensor streams normalized WiFi telemetry to a FastAPI backend, and the React operator
console consumes the backend through OpenAPI-generated types and authenticated
WebSockets.

## Current Status

The repository now contains the full foundation for passive monitoring plus the
backend command plane needed by the frontend lab surfaces:

- monorepo guardrails, GitHub Actions quality/security gates, compose stacks, ADRs,
  threat model, and runbooks
- Raspberry Pi `sensor-agent` v1 for passive Kismet ingestion, backend WebSocket
  streaming, command dispatch, reconnects, and local health endpoints
- FastAPI backend with cookie auth, CSRF, TOTP step-up, sensors, APs, clients,
  events, alerts, alert rules, audit, acknowledgements, engagements, reporting, and
  operator/sensor WebSockets
- active lab command endpoints for `rogue-ap`, `deauth`, `evil-twin`,
  `captive-portal`, and `mitm`, with default-deny gates and audit on both refusals
  and accepted commands
- React frontend stages 1-6: design system, shell, auth, overview, sensors,
  networks, devices, alerts, lab/engagement panels, reporting surfaces, and
  frontend security hardening

Backend/frontend coordination is through `packages/shared-types/`,
`packages/shared-types/schemas/openapi.json`, and the committed generated frontend
types in `apps/frontend/src/services/api/openapi.d.ts`.

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
