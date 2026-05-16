# @cheeky-pony/frontend

Operator dashboard for Cheeky Pony — built with Vite + React 19 + TypeScript (strict) + Tailwind 4.

The single source of truth for visual and interaction design is **[`/docs/frontend-design.md`](../../docs/frontend-design.md)**. Read it before touching any component.

## Develop

```bash
pnpm install        # from the repo root, once
pnpm --filter @cheeky-pony/frontend dev
```

The dev server runs on `http://localhost:5173` and expects the backend at `http://localhost:8000`.

## Scripts

| Script               | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `dev`                | Start the Vite dev server                                                 |
| `build`              | Type-check + build for production                                         |
| `preview`            | Preview the production build locally                                      |
| `lint`               | Run ESLint with zero-warning policy                                       |
| `format`             | Apply Prettier                                                            |
| `format:check`       | Verify Prettier formatting                                                |
| `typecheck`          | Run `tsc --noEmit` against all project references                         |
| `test`               | Run Vitest once with coverage; fails below 85% lines/functions/statements |
| `test:watch`         | Watch-mode tests                                                          |
| `generate:api-types` | Regenerate `src/services/api/openapi.d.ts` from the backend OpenAPI dump  |

## Where things live

- `src/styles/` — design tokens + Tailwind 4 theme + global resets
- `src/components/branding/` — `Glyph`, `Wordmark`
- `src/components/ui/` — primitives (Button, Input, Badge, Chip, Tooltip, Skeleton, Separator)
- `src/components/domain/` — Cheeky-Pony-specific primitives (LiveDot, SignalBars, StatTile, …)
- `src/routes/` — page-level components
- `src/hooks/` — shared hooks
- `src/lib/` — pure, React-free utilities
- `src/services/api/` — generated OpenAPI types + thin client (filled in Stage 2)
- `src/test/` — Vitest setup + colocated test files for `src/**`

## Conventions

- **No file over 400 lines, no function over 50.** Split before you abstract.
- **Strict TS** — no `any`, no non-null `!`, no untyped `unknown` at trust boundaries.
- **No hardcoded hex outside `tokens.css` and `Glyph.tsx`.** Use Tailwind utilities or token references.
- **No business logic in components** — extract into hooks (`useFoo`) or `src/services/`.
- **Mono for data, sans for prose.** See section 2.2 of the design spec.
- **Tests live next to the code they cover** under `src/test/<Component>.test.tsx` and the file naming mirrors the component.
