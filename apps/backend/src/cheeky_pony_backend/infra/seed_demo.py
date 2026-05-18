# SPDX-License-Identifier: AGPL-3.0-only
"""Seed and remove local synthetic demo data."""

from __future__ import annotations

import argparse
import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.infra.demo_dataset import DemoDataset, build_demo_dataset
from cheeky_pony_backend.infra.mongo_store import SYNTHETIC_COUNT_COLLECTIONS, MongoStore
from cheeky_pony_shared import (
    AccessPoint,
    Alert,
    AlertRule,
    AuditLog,
    Client,
    Engagement,
    Event,
    Sensor,
)

LOGGER = logging.getLogger(__name__)
DEFAULT_ACTOR = "system:seed"


@dataclass(frozen=True)
class SeedOptions:
    """Command-line options for the demo seeder."""

    clean: bool
    with_active: bool
    force: bool
    actor_id: str


def main() -> None:
    """Run the demo seeder CLI."""

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(asyncio.run(run(_parse_args(None))))


async def run(options: SeedOptions) -> int:
    """Apply the requested seed operation and return a process exit code."""

    settings = get_settings()
    store = MongoStore(settings.mongo_dsn, settings.mongo_db)
    try:
        await store.ensure_indexes()
        refusal = await _refusal_reason(settings, store, options.force)
        if refusal is not None:
            LOGGER.error("refusing demo seed operation: %s", refusal)
            return 1
        if options.clean:
            counts = await _clean(store, options.actor_id)
            LOGGER.info("removed synthetic demo records: %s", counts)
            return 0
        counts = await _seed(store, options)
        LOGGER.info("seeded synthetic demo records: %s", counts)
        return 0
    finally:
        store.client.close()


async def _seed(store: MongoStore, options: SeedOptions) -> dict[str, int]:
    dataset = build_demo_dataset(datetime.now(tz=UTC), options.with_active)
    await _upsert_dataset(store, dataset)
    counts = _seed_counts(dataset)
    await AuditLogger(store).record(
        options.actor_id,
        "demo.seed.run",
        {},
        {"counts": counts, "with_active": options.with_active},
        "ok",
    )
    return counts


async def _clean(store: MongoStore, actor_id: str) -> dict[str, int]:
    deleted: dict[str, int] = {}
    for collection_name in SYNTHETIC_COUNT_COLLECTIONS:
        result = await store.db[collection_name].delete_many({"synthetic": True})
        deleted[collection_name] = int(result.deleted_count)
    await AuditLogger(store).record(actor_id, "demo.seed.clean", {}, {"deleted": deleted}, "ok")
    return deleted


async def _refusal_reason(
    settings: Settings,
    store: MongoStore,
    force: bool,
) -> str | None:
    if force:
        return None
    if settings.env.lower() != "dev":
        return "CHEEKY_PONY_ENV must be dev"
    if settings.lab_mode:
        return "CHEEKY_PONY_LAB_MODE must be false"
    if await _recent_real_sensor_seen(store):
        return "a non-synthetic sensor reported within the last 5 minutes"
    return None


async def _recent_real_sensor_seen(store: MongoStore) -> bool:
    cutoff = datetime.now(tz=UTC) - timedelta(minutes=5)
    docs = store.db.sensors.find({"synthetic": {"$ne": True}}, {"_id": False})
    async for doc in docs:
        sensor = Sensor.model_validate(doc)
        if sensor.last_seen is not None and sensor.last_seen >= cutoff:
            return True
    return False


async def _upsert_dataset(store: MongoStore, dataset: DemoDataset) -> None:
    await _upsert_sensors(store, dataset.sensors)
    await _upsert_access_points(store, dataset.access_points)
    await _upsert_clients(store, dataset.clients)
    await _upsert_events(store, dataset.events)
    await _upsert_alerts(store, dataset.alerts)
    await _upsert_alert_rules(store, dataset.alert_rules)
    await _upsert_engagements(store, dataset.engagements)
    await _upsert_allow_list(store, dataset.allow_list)
    await _insert_missing_audit(store, dataset.audit_logs)


async def _upsert_sensors(store: MongoStore, sensors: list[Sensor]) -> None:
    for sensor in sensors:
        await store.db.sensors.replace_one(
            {"id": sensor.id},
            sensor.model_dump(mode="json"),
            upsert=True,
        )


async def _upsert_access_points(store: MongoStore, access_points: list[AccessPoint]) -> None:
    for access_point in access_points:
        await store.db.access_points.replace_one(
            {"bssid": access_point.bssid},
            access_point.model_dump(mode="json"),
            upsert=True,
        )


async def _upsert_clients(store: MongoStore, clients: list[Client]) -> None:
    for client in clients:
        await store.db.clients.replace_one(
            {"mac": client.mac},
            client.model_dump(mode="json"),
            upsert=True,
        )


async def _upsert_events(store: MongoStore, events: list[Event]) -> None:
    for event in events:
        await store.db.events.replace_one(
            {"id": event.id},
            event.model_dump(mode="json"),
            upsert=True,
        )


async def _upsert_alerts(store: MongoStore, alerts: list[Alert]) -> None:
    for alert in alerts:
        await store.db.alerts.replace_one(
            {"id": alert.id},
            alert.model_dump(mode="json"),
            upsert=True,
        )


async def _upsert_alert_rules(store: MongoStore, alert_rules: list[AlertRule]) -> None:
    for rule in alert_rules:
        await store.db.alert_rules.replace_one(
            {"id": rule.id},
            rule.model_dump(mode="json"),
            upsert=True,
        )


async def _upsert_engagements(store: MongoStore, engagements: list[Engagement]) -> None:
    for engagement in engagements:
        await store.db.engagements.replace_one(
            {"id": engagement.id},
            engagement.model_dump(mode="json"),
            upsert=True,
        )


async def _upsert_allow_list(store: MongoStore, allow_list: list[dict[str, object]]) -> None:
    for target in allow_list:
        query = {
            "engagement_id": target["engagement_id"],
            "kind": target["kind"],
            "value": target["value"],
        }
        await store.db.allow_list.replace_one(query, target, upsert=True)


async def _insert_missing_audit(store: MongoStore, audit_logs: list[AuditLog]) -> None:
    for audit_log in audit_logs:
        exists = await store.db.audit_logs.count_documents({"id": audit_log.id})
        if exists == 0:
            await store.db.audit_logs.insert_one(audit_log.model_dump(mode="json"))


def _seed_counts(dataset: DemoDataset) -> dict[str, int]:
    return {
        "sensors": len(dataset.sensors),
        "access_points": len(dataset.access_points),
        "clients": len(dataset.clients),
        "events": len(dataset.events),
        "alerts": len(dataset.alerts),
        "alert_rules": len(dataset.alert_rules),
        "engagements": len(dataset.engagements),
        "allow_list": len(dataset.allow_list),
    }


def _parse_args(argv: Sequence[str] | None) -> SeedOptions:
    parser = argparse.ArgumentParser(description="Seed synthetic Cheeky Pony demo data.")
    parser.add_argument("--clean", action="store_true", help="remove synthetic demo records")
    parser.add_argument("--with-active", action="store_true", help="seed one active engagement")
    parser.add_argument("--force", action="store_true", help="override local safety refusals")
    parser.add_argument("--actor-id", default=DEFAULT_ACTOR, help="actor id for audit entries")
    args = parser.parse_args(argv)
    return SeedOptions(
        clean=bool(args.clean),
        with_active=bool(args.with_active),
        force=bool(args.force),
        actor_id=str(args.actor_id),
    )


if __name__ == "__main__":
    main()
