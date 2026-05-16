# Architecture

Cheeky Pony is split into three deployable surfaces:

- `sensor-agent`: a Raspberry Pi service that talks to local WiFi tooling and streams normalized passive events.
- `backend`: FastAPI, MongoDB, Redis, and workers on the operator PC.
- `frontend`: a separately owned React application that consumes OpenAPI-generated types.

The backend owns authorization, active-operation gates, audit logging, persistence, and event fan-out. The sensor owns local process management and normalizing device telemetry.

All active lab functionality is disabled unless the backend validates lab mode, legal acknowledgement, and an allow-listed target.
