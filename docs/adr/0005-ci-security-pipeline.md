# ADR 0005: CI Security Pipeline

## Status

Accepted

## Context

The project needs high confidence before adding active lab modules.

## Decision

Use separate GitHub Actions workflows for lint/test, SAST, SCA, DAST, AI review, and release. Upload SARIF where supported and fail SCA on high or critical dependency/container findings.

## Consequences

The default PR signal is split by concern, making security regressions easier to triage.
