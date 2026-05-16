# ADR 0001: Backend and Sensor-Agent Architecture

## Status

Accepted

## Context

Cheeky Pony needs a Raspberry Pi sensor that collects local WiFi telemetry and a PC-hosted backend that owns persistence, authorization, audit, and operator-facing APIs.

## Decision

Use a FastAPI backend with dependency-injected repositories and services. Use a separate asyncio sensor-agent that talks to Kismet locally, normalizes events into shared Pydantic models, and streams those events over an authenticated WebSocket.

## Consequences

The frontend can remain independently developed against OpenAPI. Sensor code has no direct database access. Backend authorization decisions stay centralized.
