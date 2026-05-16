# ADR 0002: MongoDB Storage

## Status

Accepted

## Context

The platform stores append-heavy event documents, flexible telemetry payloads, audit logs, and device snapshots.

## Decision

Use MongoDB through Motor. Create indices for `(sensor_id, occurred_at)`, `bssid`, and `mac`. Keep audit logs append-only at the API layer and do not expose delete routes.

## Consequences

MongoDB fits telemetry shape changes without schema migrations for every parser revision. Application services still validate inputs with Pydantic before persistence.
