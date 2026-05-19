# Local Development Runbook

## Bootstrap

```bash
make bootstrap
```

This creates the Python virtual environment, installs the backend, sensor-agent, and
shared-types packages in editable mode, installs workspace Node dependencies, and
sets up pre-commit when available.

## Start Services

For a compose smoke test:

```bash
make up
```

This starts MongoDB, Redis, the backend on `http://localhost:8000`, and the hardened
nginx frontend placeholder on `http://localhost:5173`.

For active frontend development, do not start the placeholder frontend service on the
same port. Start the backend stack, then run Vite:

```bash
docker compose -f infra/docker-compose.yml up --build mongo redis backend
pnpm --filter @cheeky-pony/frontend dev
```

Useful endpoints:

- backend health: `http://localhost:8000/health`
- OpenAPI: `http://localhost:8000/openapi.json`
- frontend dev server: `http://localhost:5173`

## Run Checks

```bash
make lint
make test
pnpm --filter @cheeky-pony/frontend run typecheck
pnpm --filter @cheeky-pony/frontend run lint
pnpm --filter @cheeky-pony/frontend run format:check
pnpm --filter @cheeky-pony/frontend run test
pnpm --filter @cheeky-pony/frontend run build
```

GitHub Actions also runs SAST, SCA, DAST, CodeQL, gitleaks, and the optional AI
review workflow on pull requests.

## Regenerate Contracts

Backend schema changes:

```bash
make openapi
```

Frontend generated artifacts:

```bash
pnpm --filter @cheeky-pony/frontend run generate:api-types
pnpm --filter @cheeky-pony/frontend run generate:routes
```

Commit changes under `packages/shared-types/`,
`apps/frontend/src/services/api/openapi.d.ts`, and
`apps/frontend/src/routeTree.gen.ts` whenever those generators produce diffs. CI
fails on drift.

## Branch Hygiene

Use one branch per PR. Before creating a branch, fetch and base it on current
`origin/main`:

```bash
git fetch origin main
git switch -c <branch-name> origin/main
```

When running parallel Codex and Claude sessions, prefer separate worktrees so one
agent cannot switch or restage the other's files.
