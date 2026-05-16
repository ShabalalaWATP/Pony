# ADR 0006 — Frontend stack

**Status:** Accepted · 2026-05-16
**Owner:** Claude Code (`apps/frontend/`)
**Related:** ADR 0001 (architecture), `docs/frontend-design.md`

## Context

The operator dashboard is built independently from the backend (Codex) and the sensor-agent. It needs to:

- present a modern, dark, "techy" operator UI (per `docs/frontend-design.md`),
- talk to the FastAPI backend via REST + the operator WebSocket,
- enforce the same SOLID / file-size / coverage discipline as the rest of the codebase,
- ship through the same CI gates (SAST, SCA, DAST, AI review),
- stay free / open-source and avoid heavyweight runtime dependencies.

## Decision

| Concern              | Choice                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| Build tool           | **Vite 6** — fast HMR, esbuild + Rollup pipeline, first-class Tailwind 4 |
| Framework            | **React 19**                                                            |
| Language             | **TypeScript 5.7** in `strict` mode + `noUncheckedIndexedAccess`         |
| Styling              | **Tailwind 4** via `@tailwindcss/vite`; tokens in CSS `@theme`           |
| Component primitives | Hand-rolled in `components/ui/`, built on **Radix Primitives** (Tooltip, Slot) + `class-variance-authority`. No shadcn CLI — we own the source. |
| Icons                | **lucide-react** (single OSS pack, ESM tree-shakes well)                 |
| Fonts                | `@fontsource-variable/{geist,geist-mono,space-grotesk}` — self-hosted   |
| Server state         | **TanStack Query** (added Stage 2)                                      |
| Routing              | **TanStack Router** (added Stage 2)                                     |
| UI state             | **Zustand** (added Stage 2)                                             |
| Test runner          | **Vitest** with `@testing-library/react` + `jsdom`                       |
| Coverage             | **v8** provider; 85% lines / functions / statements gate                |
| Lint                 | **ESLint 9 flat config** + `typescript-eslint` (type-checked rules)      |
| Format               | **Prettier 3** — config shared with the repo root                       |
| API types            | Generated from `packages/shared-types/schemas/openapi.json` via `openapi-typescript`; committed to the repo |

## Rationale

- **Why Vite 6 over Next.js**: this is a single-page operator dashboard, not a content site. We need fast HMR and a small client bundle, not SSR / RSC. Next would add a server runtime we don't want.
- **Why Tailwind 4**: the new `@theme` CSS-first config maps naturally onto our HSL token system. Utilities are generated from the same custom properties the runtime references, which keeps the design system honest.
- **Why hand-roll primitives over installing the shadcn CLI**: shadcn copy-pastes its source into the repo anyway. Vendoring our own thin Radix wrappers keeps `<400-line files` and zero opaque dependencies.
- **Why TanStack Query / Router**: best-in-class for our use case, type-safe, and the team-of-one-Claude can lean on its docs in subsequent stages.
- **Why generate API types**: drift between backend and frontend is the leading cause of cross-team bugs. The `openapi-typescript` step runs in CI; if `apps/backend/` changes the schema, the frontend build fails until types are regenerated, exactly mirroring how `scripts/generate-openapi-types.py` polices the Python contract.

## Consequences

- The frontend ships an opinionated visual identity and a clear component contract — see `/design-system` for the live showcase.
- Stage 2+ will layer the router, auth flows, and live-data plumbing on this foundation without revisiting the build chain.
- `pnpm-lock.yaml` lives at the workspace root. When backend deps change in parallel, the agent that merges second rebases and regenerates the lockfile via `pnpm install`.
- The frontend job in `.github/workflows/lint-test.yml` runs alongside the existing `python` job and is independent — neither blocks the other.

## Alternatives considered

- **Next.js 15**: rejected (no SSR/RSC need, larger surface area).
- **Astro / Remix**: rejected (same reason).
- **CSS-in-JS (Stitches, vanilla-extract)**: rejected — Tailwind 4 with `@theme` gives us tokens + utilities + tree-shaking without adding a runtime.
- **Chart libraries**: deferred — we render light SVG sparklines ourselves in Stage 1; Recharts and Visx come in Stage 4 when richer charts are needed.
