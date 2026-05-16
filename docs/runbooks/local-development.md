# Local Development Runbook

## Start services

```bash
make up
```

## Run checks

```bash
make lint
make test
```

## Regenerate contracts

```bash
make openapi
```

Commit changes under `packages/shared-types/` whenever OpenAPI changes.
