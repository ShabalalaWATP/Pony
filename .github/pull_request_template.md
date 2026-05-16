## Summary
<!-- 1–3 bullets describing the intent of this PR (the why, not the what). -->

## Scope

- [ ] Backend (`apps/backend/`)
- [ ] Sensor-agent (`apps/sensor-agent/`)
- [ ] Frontend (`apps/frontend/`)
- [ ] Infra (`infra/`)
- [ ] Shared types (`packages/shared-types/`)
- [ ] CI / tooling (`.github/`, `Makefile`, root config)
- [ ] Docs only

## Tested by
<!-- Concrete commands you ran (or asked CI to run) and their outcome. -->

- [ ] `make lint`
- [ ] `make test`
- [ ] `pnpm --filter @cheeky-pony/frontend lint`
- [ ] `pnpm --filter @cheeky-pony/frontend test`
- [ ] `pnpm --filter @cheeky-pony/frontend build`

## Security checklist

- [ ] No new High/Critical SAST findings
- [ ] No new dependency advisories (pip-audit / pnpm audit / osv-scanner)
- [ ] If a new attack surface was added, `docs/threat-model.md` is updated
- [ ] If active-module code is touched, the `LAB_MODE` + acknowledgement + allow-list gates remain enforced
- [ ] No secrets committed (gitleaks clean)

## Design / docs

- [ ] If a non-obvious decision was made, an ADR landed under `docs/adr/`
- [ ] If user-facing behaviour changed, `docs/operator-guide.md` is updated
- [ ] Screenshots attached for any new UI view
