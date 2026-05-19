# ADR-0010: Demo Stream Relay

## Context

`python -m cheeky_pony_backend.infra.seed_demo --stream` runs as a separate CLI
process, while the operator WebSocket `OperatorBroker` is an in-process FastAPI
object. A direct call from the CLI to the broker would publish only inside the CLI
process and would not reach connected dashboard clients.

## Decision

Stream mode writes transient synthetic operator-topic records to a MongoDB queue.
The backend lifespan starts a small relay when the active store supports that
queue. The relay polls, publishes through the same operator topic helpers used by
real sensor events, and deletes records after broadcast. Queue records are marked
`synthetic: true` and also have a short TTL so abandoned records age out.

The CLI keeps the static seeder safety guards: it refuses outside development,
refuses while lab mode is live, and refuses when a non-synthetic sensor has
reported recently unless `--force` is supplied. It audits one stream start and one
stream stop event rather than one audit row per emitted topic.

## Consequences

- `make seed-demo-stream` works with the existing backend process and does not add
  a new HTTP endpoint or authentication surface.
- Running the CLI without a backend still queues records briefly, but no operator
  client receives them until a backend relay is active.
- MongoDB remains the only cross-process dependency for this dev-only feature.

## Alternatives Considered

- Direct CLI calls to `OperatorBroker`: rejected because the broker is process-local.
- A dev-only HTTP publish endpoint: rejected because it would add a new state-like
  surface that needs auth, CSRF, rate limiting, and audit decisions.
- Redis pub/sub: rejected for this slice because MongoDB is already required by
  the seeder and the queue is low-rate, transient, and development-only.
