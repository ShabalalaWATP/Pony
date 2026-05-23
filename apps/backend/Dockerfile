# SPDX-License-Identifier: AGPL-3.0-only
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tshark \
    && rm -rf /var/lib/apt/lists/*
RUN addgroup --system cheekypony && adduser --system --ingroup cheekypony cheekypony

COPY packages/shared-types /app/packages/shared-types
COPY apps/backend /app/apps/backend
RUN pip install --no-cache-dir -e /app/packages/shared-types -e /app/apps/backend

EXPOSE 8000
USER cheekypony
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).read()"]
CMD ["python", "-m", "uvicorn", "cheeky_pony_backend.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
