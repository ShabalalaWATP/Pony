# SPDX-License-Identifier: AGPL-3.0-only
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY packages/shared-types /app/packages/shared-types
COPY apps/sensor-agent /app/apps/sensor-agent
RUN pip install --no-cache-dir -e /app/packages/shared-types -e /app/apps/sensor-agent

USER nobody
CMD ["cheeky-pony-sensor", "--config", "/etc/cheeky-pony/sensor.toml"]
