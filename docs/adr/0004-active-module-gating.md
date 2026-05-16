# ADR 0004: Active Module Gating

## Status

Accepted

## Context

Active WiFi operations are dual-use and must be constrained to authorized lab targets.

## Decision

Every active operation must pass three backend gates:

- `LAB_MODE=true`
- a stored `authorized_operator` acknowledgement exists
- the target is present in the engagement allow-list

Failures return `403` and write audit records. Successful active actions also write audit records with operator, target, parameters, timestamps, outcome, and raw-output reference.

## Consequences

Future active modules can be implemented behind one policy service instead of scattering checks across controllers.
