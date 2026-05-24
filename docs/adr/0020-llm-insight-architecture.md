# ADR-0020: LLM insight architecture

## Context

Cheeky Pony needs operator-readable explanations for alerts and later for
engagements, access points, and PCAP findings. The production target is a
private OpenAI-compatible model endpoint, while development can use the OpenAI
API. The LLM sees metadata derived from operator-captured network data, so every
call crosses a trust boundary even when the model is self-hosted.

## Decision

LLM access is exposed through named service methods only. Slice 3A ships
`alert_context(alert_id)` and does not provide a generic prompt endpoint or
`ask(prompt)` method. Adding a new insight kind requires a new method, prompt
context builder, versioned template, output schema, tests, and review.

Prompt templates live in the repository under
`cheeky_pony_backend/llm/prompts/vN/`. The template version participates in the
cache key together with the insight kind, entity id, and redacted prompt hash.
Changing a template version invalidates only that template's cache.

Every prompt passes through the backend redactor before dispatch. MAC and BSSID
values are mapped to prompt-scoped opaque tokens, sensitive keys are dropped, and
SSID/vendor redaction can be enabled by settings. Audit records store only
prompt and response hashes plus token and cost metadata.

Budget accounting records spend in integer micro-cents in Mongo. The service
reserves an estimated cost before dispatch and adjusts it after actual token
usage is returned. A monthly budget of `0` means unlimited, intended for local
models with no per-call billing.

## Consequences

- The frontend can request only vetted insight kinds by entity id.
- Provider portability is a settings change as long as the endpoint implements
  the OpenAI chat-completions contract.
- Failed output validation returns an unavailable response and never reaches the
  operator UI verbatim.
- Cache keys are stable and automatically separate template revisions.
- Budget reservations may briefly overestimate spend until the response returns,
  which is safer than dispatching calls that could exceed the cap.

## Alternatives Considered

- **Generic prompt API**: rejected because it would create a prompt-injection and
  data-exfiltration surface outside code review.
- **Store raw prompts/responses for debugging**: rejected because audit logs and
  cache records would become a sensitive-data sink.
- **Float USD accounting**: rejected to avoid rounding drift and race-prone
  budget checks.
- **Provider-specific SDK**: rejected because production targets an
  OpenAI-compatible private endpoint and should not require code changes.
