# ADR-0021: LLM runtime kill switch

## Context

`CHEEKY_PONY_LLM_ENABLED=false` is the hard opt-in boundary for every LLM
dispatch. Operators also need an emergency control that can stop LLM calls
without restarting the backend, for example when captured metadata is later
judged too sensitive to send even to a private model endpoint.

## Decision

Add a Mongo-backed `system_runtime_flags.llm_kill_switch` record. When the flag
is disabled, the LLM service refuses every insight generation path before cache,
budget, or provider dispatch. The flag is checked by HTTP routes, worker tasks,
and demo seeding through the same service dependency.

The runtime flag only layers an emergency disable over the environment opt-in:
`CHEEKY_PONY_LLM_ENABLED=false` still wins and cannot be overridden from the API.
Clearing the runtime flag re-enables dispatch only when the environment setting
is already enabled.

Changing the runtime flag requires admin, recent TOTP, CSRF, and a typed
confirmation body (`DISABLE` or `ENABLE`). Every success and refusal is audited
with `llm.kill_switch.toggle`.

## Consequences

- Operators can stop LLM dispatch immediately without redeploying.
- Production deployments keep a restart-controlled hard kill switch through the
  environment variable.
- Runtime flag state is small, auditable, and survives process restarts.
- Tests must inject the runtime flag dependency so HTTP, workers, and seeding all
  observe the same effective enabled state.

## Alternatives Considered

- **Environment-only kill switch**: rejected because it requires a process
  restart in the exact emergency workflow where delay is undesirable.
- **In-memory flag only**: rejected because state would disappear on restart and
  could diverge across workers.
- **API can force-enable over the environment**: rejected because it weakens the
  original opt-in contract and could surprise operators who intentionally set
  `LLM_ENABLED=false`.
