# ADR 0014: Lab Readiness on Lab Status

## Context

The frontend already calls `GET /api/v1/lab/status` to explain why active lab
modules are blocked. Adding a separate readiness route would duplicate the same
settings, user, engagement, acknowledgement, and allow-list reads while forcing
callers to stitch two closely related responses together.

## Decision

Extend `GET /api/v1/lab/status` with additive `ready` and `checks` fields. The
existing `lab_mode`, `acknowledgement_on_file`, and `is_admin_2fa` fields remain
unchanged for older clients.

Checklist computation lives in `domain/lab_readiness.py` as a pure function over
already-fetched facts. The status route performs the bounded repository reads and
passes booleans into the domain function.

The route stays authenticated but not admin-gated. Non-admin operators can see
that admin role and recent TOTP are missing before asking an admin for access.
Unauthenticated refusals are audited as `lab.status.read`.

## Consequences

- Existing clients that read only the original fields keep working.
- New clients can render a guided readiness checklist from a single response.
- The endpoint remains read-only and does not bypass any active-module gate.
- Status responses recompute per request so gate changes show immediately.

## Alternatives Considered

- New `/lab/readiness` route: rejected because it would duplicate the same
  backend reads and increase frontend coordination.
- Admin-gating the readiness route: rejected because operators need to see that
  admin role is the missing prerequisite.
- Persisting readiness state: rejected because readiness is entirely derived from
  current settings and datastore state.
