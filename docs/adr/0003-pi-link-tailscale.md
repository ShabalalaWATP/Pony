# ADR 0003: Raspberry Pi Link Over Tailscale

## Status

Accepted

## Context

The Pi and backend host may be on different networks but need a private authenticated channel.

## Decision

Use Tailscale for the Pi-to-PC network path and mTLS for sensor identity at the WebSocket gateway.

## Consequences

The deployment can start on the free Tailscale tier and later swap to Headscale without changing the application protocol.
