PYTHON ?= python
BACKEND_DIR := apps/backend
SENSOR_DIR := apps/sensor-agent
SHARED_DIR := packages/shared-types

.PHONY: bootstrap lint test up down openapi license seed-demo unseed-demo

bootstrap:
	uv venv --python 3.12 || $(PYTHON) -m venv .venv
	uv pip install -e "$(SHARED_DIR)[dev]" -e "$(BACKEND_DIR)[dev]" -e "$(SENSOR_DIR)[dev]" || .venv/Scripts/python -m pip install -e "$(SHARED_DIR)[dev]" -e "$(BACKEND_DIR)[dev]" -e "$(SENSOR_DIR)[dev]"
	pnpm install || true
	pre-commit install || true

lint:
	ruff check apps packages scripts
	ruff format --check apps packages scripts
	mypy apps/backend/src apps/sensor-agent/src packages/shared-types/src scripts

test:
	pytest apps/backend/tests apps/sensor-agent/tests --cov=cheeky_pony_backend --cov=cheeky_pony_sensor --cov=cheeky_pony_shared --cov-report=term-missing --cov-fail-under=85

up:
	docker compose -f infra/docker-compose.yml up --build

down:
	docker compose -f infra/docker-compose.yml down -v

openapi:
	python scripts/generate-openapi-types.py

license:
	python scripts/add-license-headers.py

seed-demo:
	$(PYTHON) -m cheeky_pony_backend.infra.seed_demo

unseed-demo:
	$(PYTHON) -m cheeky_pony_backend.infra.seed_demo --clean
