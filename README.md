# Cheeky Pony

Cheeky Pony is a self-hosted WiFi monitoring platform with passive sensor collection first and strictly gated active lab capabilities later.

This repository currently implements milestones 0-2:

- monorepo guardrails, CI/CD, compose, security docs, ADRs
- Raspberry Pi sensor agent v1 for passive Kismet ingestion and backend WebSocket streaming
- FastAPI backend core with auth, sensors, device/event APIs, audit, acknowledgements, and sensor/operator WebSockets

`apps/frontend/` is intentionally not owned here. Frontend work coordinates through OpenAPI and `packages/shared-types/`.

## Local setup

```bash
make bootstrap
make lint
make test
make up
```

If `uv` or `pnpm` are not installed, install them first or use Python directly:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e "packages/shared-types[dev]" -e "apps/backend[dev]" -e "apps/sensor-agent[dev]"
```

## Security posture

Active operations are deliberately blocked unless all three gates are true:

- backend `CHEEKY_PONY_LAB_MODE=true`
- an `authorized_operator` acknowledgement exists
- the requested target is in the engagement allow-list

Missing gates return `403` and write an audit entry. Audit records are append-only and no delete route is exposed.
