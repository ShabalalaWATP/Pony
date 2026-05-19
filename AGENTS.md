# Cheeky Pony — Codex brief (backend, sensor-agent, infra, CI/CD)

**You are working on Cheeky Pony**, a self-hosted WiFi reconnaissance + offensive
WiFi platform. A Raspberry Pi sensor (`apps/sensor-agent`) drives Kismet +
bettercap and streams normalised telemetry to a FastAPI backend
(`apps/backend`) over an mTLS WebSocket on a Tailscale tailnet. A React frontend
(`apps/frontend`, owned by Claude Code — do not touch) consumes the backend via
OpenAPI-generated types.

This file is your **standing brief**. Re-read it on every session before you
write code. If you find guidance here that contradicts the existing codebase,
the codebase is wrong — flag it and ask before fixing.

---

## Ownership boundaries

You own:

- `apps/backend/`
- `apps/sensor-agent/`
- `packages/shared-types/`
- `infra/` (docker-compose, Pi install scripts, Tailscale notes)
- `.github/workflows/`
- `docs/` (architecture, threat model, ADRs, runbooks, operator guide)
- `scripts/` (license headers, OpenAPI codegen, demo seeders)
- Root guardrails: `Makefile`, `.pre-commit-config.yaml`, `pyproject.toml`,
  `.gitleaks.toml`, `.env.example`, `SECURITY.md`, `CHANGELOG.md`

You do **not** own:

- `apps/frontend/` — Claude Code's territory. Coordinate via OpenAPI only.
- If you need a new endpoint that the frontend will consume, ship it on a
  feature branch, regenerate the shared types, commit them, and open the PR.
  Do not edit anything under `apps/frontend/`.

---

## Non-negotiables (security)

These are baked into the codebase. **If a PR weakens any of them, it must be
rejected**, even your own.

1. **Active modules are default-deny.** Every active lab module
   (`rogue-ap`, `deauth`, `evil-twin`, `captive-portal`, `mitm`) gates on
   ALL of:
   - `CHEEKY_PONY_LAB_MODE=true`
   - an `authorized_operator` system acknowledgement on file
   - the caller is `admin` with TOTP verified within
     `CHEEKY_PONY_TOTP_RECENT_MINUTES`
   - CSRF header on the state-changing request
   - the request scopes an active engagement
   - the target is in that engagement's allow-list

   Missing any gate ⇒ `403` with a structured `reason` field + audit entry.
   See [`docs/architecture.md`](docs/architecture.md#lab-gate-stack) for the
   diagram and [`docs/threat-model.md`](docs/threat-model.md) for the STRIDE
   per surface.

2. **Audit logs are append-only.** Every state-changing endpoint
   (mutations, sensor commands, lab starts/stops, user updates, allow-list
   edits, acknowledgements, engagement lifecycle) writes an `AuditLog`
   entry on **both success and refusal**. There is no `DELETE` route on
   `/api/v1/audit`. The collection has no admin-facing delete affordance.

3. **No shell strings.** Every subprocess call uses
   `asyncio.create_subprocess_exec` with an argument list. Never
   string-concatenate user input into a command line. The Pi-side
   sensor-agent is the highest-risk surface for this.

4. **Inputs validated at the boundary.** Pydantic v2 models on every
   API route body, query param, and path param. `extra="forbid"` on
   write models. Enum unions for anything role-shaped.

5. **No secrets in code or default env.** Read from environment via
   `pydantic-settings`. `.env.example` only carries placeholders.
   Production-like environments must reject known dev secrets at startup
   (already implemented in `config.py`).

6. **Sensitive parameter keys are redacted before audit persistence.**
   Keys matching `credentials | tokens | secrets | keys | handshakes`
   are stripped from audit `parameters` blobs. Captured credentials must
   never enter the audit log.

7. **mTLS sensor identity binding.** The sensor WebSocket binds the
   sensor id to the signed client-certificate fingerprint stored at
   registration time. Never trust the sensor's self-reported id alone.

8. **Synthetic data must never come from a real sensor.** The
   `synthetic: bool` field exists on `AccessPoint`, `Client`, `Event`,
   `Alert` for demo seeders only. The sensor-gateway must reject any
   inbound frame with `synthetic=true` (defensive — protects the real
   store from a compromised sensor pushing fake-looking data).

---

## Non-negotiables (engineering)

### File and function size

- **No source file over ~400 lines.** Split first, abstract second.
- **No function over ~50 lines.** Refactor before it grows.
- If a refactor would push a file over the limit, split before the PR.

### SOLID, applied

- **SRP**: one responsibility per module. A router file does routing; a
  store file does persistence; a service file does the domain work.
  Don't put Mongo calls in route handlers.
- **OCP**: extend via FastAPI dependencies, repository interfaces, and
  Pydantic generics — not by adding flags to existing endpoints.
- **LSP**: every concrete repository is a drop-in for its interface.
  Tests cover both the contract and the implementation.
- **ISP**: small, focused Pydantic models per endpoint. Don't make
  `User` carry ten optional fields because two callers wanted one each.
- **DIP**: route handlers depend on `Depends(get_store)` /
  `Depends(get_audit_logger)`, not on concrete classes.

### Strict typing

- `mypy --strict` is on. No `Any` (use `object` or `unknown` and parse
  at the boundary). No untyped `**kwargs` flowing through layers.
- Type all return shapes explicitly on public functions.

### Async hygiene

- All I/O is async. No `time.sleep`, no sync Mongo, no sync HTTP.
- One task per concern. Don't fan out without `asyncio.gather`.

### No dead code, no half-implementations

- Don't add a route, a model, or a config flag for "future use".
- Don't add a feature flag that has only one branch.
- If you need a feature in two months, write it in two months.

### Comments

- Default to no comments. Code + names + types are the doc.
- Only add a comment when the *why* is non-obvious (a workaround, a
  hidden invariant, a security gate, a perf hack). Never write
  comments that re-state what the code does.

### License header

- Every new Python source file: `# SPDX-License-Identifier: AGPL-3.0-only`
  as the first line. Run `python scripts/add-license-headers.py` if you
  forget — pre-commit will catch it.

### Tests

- pytest + pytest-asyncio + httpx.AsyncClient.
- testcontainers for Mongo + Redis where the test exercises the boundary.
- Hypothesis for parsers / normalisers / anything taking external input.
- **Coverage ≥ 85% (lines + branches + functions)** on every new module.
- Slow tests marked and run in a separate CI job.
- Every refusal path needs a test that asserts both the HTTP status
  *and* the audit entry. Refusals that don't audit are worse than
  refusals that aren't refused.

### Commits

- Conventional Commits prefix: `feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`. Optional scope: `feat(backend): ...`.
- Commit messages explain *why*, not *what*.
- One milestone / coherent slice per branch. One branch per PR.

### ADRs

- Write an Architecture Decision Record under `docs/adr/NNNN-*.md`
  for any non-obvious decision — choice of library, schema design that
  could've gone two ways, security trade-off. Keep them short (one
  page): context, decision, consequences, alternatives considered.
- ADR numbering is sequential. Don't reuse numbers.

---

## Coordination contract (with Claude Code)

The frontend talks to the backend exclusively through:

1. The REST API at `/api/v1/*` (described in
   `packages/shared-types/schemas/openapi.json`)
2. The operator WebSocket at `/ws/operator`
3. Generated TypeScript types in `apps/frontend/src/services/api/openapi.d.ts`

**Every schema change** ⇒ `make openapi` (regenerates the OpenAPI JSON
and the shared Python types) ⇒ frontend regeneration via
`pnpm --filter @cheeky-pony/frontend run generate:api-types` ⇒ commit
both. CI fails if the committed shared types drift from the source.

**Adding a new field?** Default it. The frontend won't know about the
field until it regenerates, and a non-default field will 422 the
existing FE.

**Adding a new endpoint?** Ship it default-deny if it touches anything
state-changing. Document the gate stack in the docstring. Add the
operator-guide entry.

---

## Definition of done (every PR)

- [ ] All CI checks green: `lint-test`, `sast` (Semgrep + Bandit + CodeQL
      + gitleaks), `sca` (pip-audit + OSV-Scanner + Trivy), `dast` (ZAP
      baseline against the compose stack), `ai-review`.
- [ ] Coverage ≥ 85% on new/changed modules.
- [ ] No new High/Critical findings in SAST or SCA.
- [ ] ADR added if a non-obvious decision was made.
- [ ] `docs/threat-model.md` updated if a new attack surface was added.
- [ ] `docs/operator-guide.md` updated if user-facing behaviour changed.
- [ ] `CHANGELOG.md` entry under `## Unreleased`.
- [ ] OpenAPI regenerated + committed if the schema changed.
- [ ] Pre-commit hooks clean (ruff format/check, mypy --strict, gitleaks).
- [ ] Conventional Commits message; no `--no-verify`.

---

## Where to look first

| You need | Read |
|---|---|
| Architecture (data flow, lab gates, login sequence, system topology) | [`docs/architecture.md`](docs/architecture.md) |
| Security analysis per surface | [`docs/threat-model.md`](docs/threat-model.md) |
| Past decisions | [`docs/adr/`](docs/adr) |
| Operator-facing behaviour | [`docs/operator-guide.md`](docs/operator-guide.md) |
| Local dev workflow | [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md) |
| Per-PR history | [`CHANGELOG.md`](CHANGELOG.md) |
| Vulnerability reporting policy | [`SECURITY.md`](SECURITY.md) |
| Live OpenAPI | `http://localhost:8000/openapi.json` once the dev stack is up |

---

## When in doubt

**Stop and ask** rather than guess. Better one paused agent than one
wrong abstraction. The user is faster to unblock you in chat than to
revert a wrong PR.
