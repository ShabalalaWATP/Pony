# SPDX-License-Identifier: AGPL-3.0-only
"""Alert rule evaluation for normalized event streams."""

from __future__ import annotations

import re
from uuid import uuid4

from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_shared import Alert, AlertRule, Event


class AlertRuleEngine:
    """Evaluate enabled alert rules against inserted events."""

    def __init__(self, store: Store) -> None:
        self._store = store

    async def evaluate_event(self, event: Event) -> list[Alert]:
        """Evaluate enabled rules for one event.

        Args:
            event: Normalized event.

        Returns:
            Persisted alerts created by matching rules.
        """

        alerts: list[Alert] = []
        for rule in await self._store.list_enabled_alert_rules():
            if self._matches(rule, event):
                alert = Alert(
                    id=str(uuid4()),
                    rule_id=rule.id,
                    severity=rule.severity,
                    related_entities=self._related_entities(event),
                )
                alerts.append(await self._store.insert_alert(alert))
        return alerts

    def _matches(self, rule: AlertRule, event: Event) -> bool:
        predicate = rule.predicate
        event_kind = predicate.get("event_kind")
        if event_kind is not None and str(event_kind) != event.kind.value:
            return False

        matched_condition = False
        match = predicate.get("match")
        if isinstance(match, dict) and match:
            matched_condition = True
            if not self._payload_matches(event, match):
                return False

        watch = predicate.get("watch")
        if isinstance(watch, list) and watch:
            matched_condition = True
            watched = {str(item).lower() for item in watch}
            entities = {entity.lower() for entity in self._related_entities(event)}
            if watched.isdisjoint(entities):
                return False

        return matched_condition or event_kind is not None

    def _payload_matches(self, event: Event, patterns: dict[object, object]) -> bool:
        for key, pattern in patterns.items():
            payload_value = event.payload.get(str(key))
            if payload_value is None or not _regex_matches(str(pattern), str(payload_value)):
                return False
        return True

    def _related_entities(self, event: Event) -> list[str]:
        entities = [event.sensor_id]
        for key in ("bssid", "ssid", "mac", "client_mac", "associated_bssid"):
            value = event.payload.get(key)
            if value is not None:
                entities.append(str(value))
        return list(dict.fromkeys(entities))


def _regex_matches(pattern: str, value: str) -> bool:
    if len(pattern) > 256:
        return False
    try:
        return re.search(pattern, value, flags=re.IGNORECASE) is not None
    except re.error:
        return False
