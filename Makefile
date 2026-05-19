PYTHON ?= python
BACKEND_DIR := apps/backend
SENSOR_DIR := apps/sensor-agent
SHARED_DIR := packages/shared-types

.PHONY: bootstrap lint test up down openapi license seed-demo seed-demo-stream unseed-demo load-test

bootstrap:
	uv venv --python 3.12 || $(PYTHON) -m venv .venv
	uv pip install -e "$(SHARED_DIR)[dev]" -e "$(BACKEND_DIR)[dev]" -e "$(SENSOR_DIR)[dev]" || .venv/Scripts/python -m pip install -e "$(SHARED_DIR)[dev]" -e "$(BACKEND_DIR)[dev]" -e "$(SENSOR_DIR)[dev]"
	pnpm install || true
	pre-commit install || true

lint:
	ruff check apps packages scripts tests/load
	ruff format --check apps packages scripts tests/load
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

seed-demo-stream:
	$(PYTHON) -m cheeky_pony_backend.infra.seed_demo --stream

unseed-demo:
	$(PYTHON) -m cheeky_pony_backend.infra.seed_demo --clean

LOAD_HOST ?= http://localhost:8000
LOAD_USERS ?= 50
LOAD_SPAWN_RATE ?= 5
LOAD_RUN_TIME ?= 10m

load-test:
	$(PYTHON) -m locust -f tests/load/locustfile.py --headless -H "$(LOAD_HOST)" -u "$(LOAD_USERS)" -r "$(LOAD_SPAWN_RATE)" --run-time "$(LOAD_RUN_TIME)"
