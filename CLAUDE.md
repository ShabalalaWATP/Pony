# Cheeky Pony — Claude Code brief (frontend)

**You are working on Cheeky Pony**, a self-hosted WiFi reconnaissance + offensive
WiFi platform. You own the operator console at `apps/frontend/` — a Vite +
React 19 + TypeScript-strict + Tailwind 4 single-page app that consumes the
backend via OpenAPI-generated types and a JWT-authenticated WebSocket.

This file is your **standing brief**. Re-read it on every session before you
write code. If you find guidance here that contradicts the existing codebase,
the codebase is wrong — flag it and ask before fixing.

---

## Ownership boundaries

You own:

- `apps/frontend/` — everything underneath

You do **not** own:

- `apps/backend/`
- `apps/sensor-agent/`
- `packages/shared-types/`
- `infra/`, `.github/workflows/`, `docs/`

Backend, sensor-agent, infra, and shared-types are Codex's territory.
Coordinate via OpenAPI only (see "Coordination contract" below).

---

## Visual / interaction spec

**`docs/frontend-design.md` is the single source of truth for visual + interaction
design.** Read it before opening any component file. If you're about to make a
design call that isn't in the spec, add it to the spec first, then write the code.

---

## Non-negotiables (security)

These are baked into the codebase. **If a PR weakens any of them, it must be
rejected**, even your own.

1. **No tokens in `localStorage` / `sessionStorage`.** Auth lives in
   httpOnly + SameSite=Strict cookies managed by the backend. CSRF
   token comes via a cookie + a header on every state-changing call.

2. **All routes under `/_shell/*` are auth-gated.** `AuthGuard` handles
   the bounce-to-login. Do not bypass it for "convenience".

3. **Active-module UI is dangerous.** Every active action goes through
   a typed-confirm modal that:
   - shows the exact target (BSSID / SSID / MAC),
   - shows whether `LAB_MODE` is on and whether the target is on the
     engagement allow-list,
   - requires the operator to type the target into a confirm input
     (à la GitHub destructive actions).
   The button never becomes a one-click affordance.

4. **No user-controlled HTML.** Zero `dangerouslySetInnerHTML`.
   String concatenation into URLs goes through `sanitizeInternalPath`
   or `safeSameOriginApiUrl` from `lib/safe-url.ts`. If you find an
   anchor or `window.open` that doesn't, it's a bug.

5. **No business logic in components.** All state-changing API calls
   go through TanStack Query mutations. All reads go through TanStack
   Query queries. Components render and dispatch.

6. **PEM material lives in component state only.** The sensor-register
   drawer is the canonical example: the private key is returned once
   by the backend, surfaced in-memory, masked behind a reveal toggle,
   and wiped when the drawer closes. Never persist to storage. Never
   render outside the drawer.

7. **No new dependencies without an ADR.** Frontend bundle size is a
   resource budget. If you need a chart library / a date library / a
   form library that we don't already have, document the choice in a
   new `docs/adr/NNNN-*.md` first.

8. **Strict TS, no `any`.** `unknown` at trust boundaries (API responses
   are typed but parse defensively where the input could drift). `as`
   casts need a comment explaining why.

---

## Non-negotiables (engineering)

### File and function size

- **No source file over ~400 lines.** Split first, abstract second.
- **No component over ~200 lines.** Split into container/presentation
  or extract sub-components.
- **No function over ~50 lines.** Refactor before it grows.

### SOLID, applied

- **SRP**: one job per file. Views render. Hooks fetch. Pure helpers
  live in `src/lib/`. Domain primitives live in `src/components/domain/`.
- **OCP**: extend via props, not by adding flags to existing components.
  Use `children`, `trailing`, `tone`, etc. — see `DetailSection`,
  `StatTile`, `LeaderRow`, `CornerBrackets` for the existing patterns.
- **LSP**: primitives are pure presentation — drop-in anywhere their
  props match.
- **ISP**: small, narrow props per component (≤ 4 ideally). No "theme
  prop" god object.
- **DIP**: components depend on hooks + tokens, not on concrete
  service implementations.

### Strict typing

- `tsc -b --noEmit` is on in CI; project-references analysis catches
  closure-narrowing surprises that loose mode misses.
- No `any`. No untyped `as`. Use `unknown` at boundaries.
- Generic shared utilities (`cn`, `safe-url`) keep their signatures
  narrow — don't widen.

### Tests

- Vitest + `@testing-library/react` + msw for HTTP. Test files live in
  `apps/frontend/src/test/<Component>.test.tsx`.
- Use the test helpers in `apps/frontend/src/test/helpers.tsx`:
  `withQuery`, `withQueryAndRouter`. Don't roll your own provider stack.
- **Coverage ≥ 85%** on `src/`.
- Every refusal/403 path needs a test. Every typed-confirm needs a test
  that the destructive button is gated until the input matches.
- Visual regression / a11y via Playwright + axe-core (when wired).

### Design tokens

- All colour, spacing, motion lives in
  `apps/frontend/src/styles/tokens.css`.
- **No hardcoded hex anywhere except `tokens.css` and `Glyph.tsx`.**
- Reference tokens via Tailwind utilities (`bg-bg-2`, `text-mode`,
  `text-accent-amber`) or via CSS custom properties for inline styles
  (`hsl(var(--mode-accent))`).
- Be wary of the `@layer base` reset on `*` border-color — Tailwind
  utilities now beat it cleanly, but inline styles still escape it
  for prop-driven colour (see `CornerBrackets` for the pattern).

### Loading + empty states

- Use `<Skeleton>` for loading. Never spinners on data surfaces.
- Use `<EmptyState>` for empty/refused. Copy explains *why*, not just
  *that*.
- 401/403 → "Sign in required" or "Admin + 2FA required" — never
  pretend it's empty.

### Accessibility

- Keyboard-navigable everywhere. Focus rings on. axe-core CI gate.
- `aria-label` on every interactive element that isn't text.
- `aria-live="polite"` on regions that update from WS events.

### Performance

- Bundle warnings (chunks > 500 kB) — investigate, don't ignore.
- Dynamic-import any single-route-only library (MapLibre, xterm.js).
- Virtualise tables over ~200 rows.

### Comments

- Default to no comments. Code + names + types are the doc.
- Comments are for the *why*: a workaround, a security gate, a
  subtle invariant, a non-obvious browser quirk. Never write
  comments that re-state what the code does.

### Commits

- Conventional Commits prefix: `feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`. Optional scope: `feat(frontend): ...`.
- Commit messages explain *why*, not *what*.
- One coherent slice per branch. One branch per PR.

### ADRs

- Write an Architecture Decision Record under `docs/adr/NNNN-*.md`
  for any non-obvious decision — library choice, state-management
  pattern, security trade-off. One page: context, decision,
  consequences, alternatives.

---

## Coordination contract (with Codex)

The backend is owned by Codex. You talk to it via:

1. The REST API at `/api/v1/*` — types in
   `apps/frontend/src/services/api/openapi.d.ts` (regenerated, do not
   hand-edit).
2. The operator WebSocket at `/ws/operator`.
3. The shared OpenAPI doc at `packages/shared-types/schemas/openapi.json`.

**Need a new endpoint?** Stop and ask. Don't stub silently. The right
response to "the backend doesn't have this yet" is to coordinate with
Codex, not to fake it in the frontend.

**Need to test against a missing endpoint?** Use msw with fixtures
derived from the eventual OpenAPI shape — but only in tests, never in
the runtime app.

**OpenAPI changed?** Run `pnpm --filter @cheeky-pony/frontend run
generate:api-types` and commit the diff. CI fails on drift.

---

## Definition of done (every PR)

- [ ] `tsc -b --noEmit` clean (CI uses `tsc -b`, which is stricter than
      bare `tsc` — replicate locally before pushing).
- [ ] `eslint src --max-warnings=0` clean.
- [ ] `prettier --check src` clean.
- [ ] `vitest run` — every test green, coverage ≥ 85%.
- [ ] `vite build` clean (chunk-size warnings investigated).
- [ ] Lighthouse ≥ 90 on Performance + Accessibility + Best Practices
      for any new route (when wired).
- [ ] axe-core CI gate green.
- [ ] Screenshots in the PR description for any new view.
- [ ] `docs/operator-guide.md` updated if user-facing behaviour
      changed.
- [ ] `docs/frontend-design.md` updated if a new design pattern was
      introduced (don't multiply primitives — re-use existing).
- [ ] `CHANGELOG.md` entry under `## Unreleased`.
- [ ] Conventional Commits message; no `--no-verify`.

---

## Where to look first

| You need | Read |
|---|---|
| Visual + interaction spec | [`docs/frontend-design.md`](docs/frontend-design.md) |
| Architecture (data flow, gate stack, sequence diagrams) | [`docs/architecture.md`](docs/architecture.md) |
| Security analysis per surface | [`docs/threat-model.md`](docs/threat-model.md) |
| Past decisions | [`docs/adr/`](docs/adr) |
| Operator-facing behaviour | [`docs/operator-guide.md`](docs/operator-guide.md) |
| Local dev workflow | [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md) |
| Per-PR history | [`CHANGELOG.md`](CHANGELOG.md) |
| Frontend conventions + scripts | [`apps/frontend/README.md`](apps/frontend/README.md) |
| Live OpenAPI | `http://localhost:8000/openapi.json` once the dev stack is up |

---

## When in doubt

**Stop and ask** rather than guess. Don't stub a missing backend
endpoint silently. Don't widen a primitive's API to fit a corner case
without checking whether the corner case is actually right.
