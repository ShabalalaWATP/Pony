# SPDX-License-Identifier: AGPL-3.0-only
"""Report contracts, signing helpers, and artifact renderers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from html import escape
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from cheeky_pony_shared import Alert, AuditLog, Engagement, Event


class ReportFormat(StrEnum):
    """Supported engagement report formats."""

    PDF = "pdf"
    HTML = "html"
    PCAP = "pcap"
    JSONL = "jsonl"


class ReportStatus(StrEnum):
    """Engagement report generation states."""

    PENDING = "pending"
    READY = "ready"
    FAILED = "failed"


class ReportCreateRequest(BaseModel):
    """Report creation request."""

    model_config = ConfigDict(extra="forbid")

    format: ReportFormat
    since: datetime
    until: datetime

    @model_validator(mode="after")
    def validate_range(self) -> ReportCreateRequest:
        """Validate the requested report time range.

        Returns:
            Validated request.
        """

        if self.until <= self.since:
            raise ValueError("until must be after since")
        return self


class ReportCreateResponse(BaseModel):
    """Report creation response."""

    report_id: str
    status: ReportStatus


class ReportStatusResponse(BaseModel):
    """Report status response."""

    status: ReportStatus
    download_url: str | None = None
    error: str | None = None


class ReportRecord(BaseModel):
    """Internal persisted engagement report record."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    engagement_id: str = Field(min_length=1, max_length=128)
    requested_by: str = Field(min_length=1, max_length=128)
    format: ReportFormat
    since: datetime
    until: datetime
    status: ReportStatus = ReportStatus.PENDING
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))
    content_b64: str | None = None
    content_type: str | None = None
    filename: str | None = None
    error: str | None = None


class ReportArtifact(BaseModel):
    """Rendered report artifact."""

    model_config = ConfigDict(extra="forbid")

    content: bytes
    content_type: str
    filename: str


def sign_report_download(
    report_id: str,
    engagement_id: str,
    secret: str,
    ttl_minutes: int,
) -> str:
    """Create a signed download token for a report.

    Args:
        report_id: Report identifier.
        engagement_id: Engagement identifier.
        secret: HMAC signing secret.
        ttl_minutes: Token lifetime in minutes.

    Returns:
        URL-safe signed token.
    """

    expires_at = int((datetime.now(tz=UTC) + timedelta(minutes=ttl_minutes)).timestamp())
    payload = {"report_id": report_id, "engagement_id": engagement_id, "expires_at": expires_at}
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    signature = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def verify_report_download_token(
    token: str,
    report_id: str,
    engagement_id: str,
    secret: str,
) -> bool:
    """Validate a report download token.

    Args:
        token: Signed token.
        report_id: Expected report identifier.
        engagement_id: Expected engagement identifier.
        secret: HMAC signing secret.

    Returns:
        Whether the token is valid and unexpired.
    """

    try:
        encoded, signature = token.rsplit(".", 1)
        expected = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return False
        payload = json.loads(base64.urlsafe_b64decode(encoded.encode()))
        return (
            payload.get("report_id") == report_id
            and payload.get("engagement_id") == engagement_id
            and int(payload.get("expires_at", 0)) >= int(datetime.now(tz=UTC).timestamp())
        )
    except Exception:
        return False


def render_report_artifact(
    report: ReportRecord,
    engagement: Engagement,
    events: list[Event],
    alerts: list[Alert],
    audit_logs: list[AuditLog],
) -> ReportArtifact:
    """Render one report artifact.

    Args:
        report: Report metadata.
        engagement: Engagement being reported.
        events: Events in the requested range.
        alerts: Alerts to summarize.
        audit_logs: Audit log entries to summarize.

    Returns:
        Rendered artifact bytes and metadata.
    """

    summary = _summary(report, engagement, events, alerts, audit_logs)
    stem = f"engagement-{engagement.id}-report-{report.id}"
    if report.format == ReportFormat.JSONL:
        content = _jsonl(summary, events, alerts, audit_logs)
        return ReportArtifact(
            content=content,
            content_type="application/x-ndjson",
            filename=f"{stem}.jsonl",
        )
    if report.format == ReportFormat.HTML:
        return ReportArtifact(
            content=_html(summary).encode(),
            content_type="text/html; charset=utf-8",
            filename=f"{stem}.html",
        )
    if report.format == ReportFormat.PCAP:
        return ReportArtifact(
            content=_empty_pcap(),
            content_type="application/vnd.tcpdump.pcap",
            filename=f"{stem}.pcap",
        )
    return ReportArtifact(
        content=_pdf(summary),
        content_type="application/pdf",
        filename=f"{stem}.pdf",
    )


def _summary(
    report: ReportRecord,
    engagement: Engagement,
    events: list[Event],
    alerts: list[Alert],
    audit_logs: list[AuditLog],
) -> dict[str, Any]:
    return {
        "report_id": report.id,
        "engagement_id": engagement.id,
        "engagement_name": engagement.name,
        "format": report.format.value,
        "since": report.since.isoformat(),
        "until": report.until.isoformat(),
        "generated_at": datetime.now(tz=UTC).isoformat(),
        "counts": {
            "events": len(events),
            "alerts": len(alerts),
            "audit_logs": len(audit_logs),
        },
    }


def _jsonl(
    summary: dict[str, Any],
    events: list[Event],
    alerts: list[Alert],
    audit_logs: list[AuditLog],
) -> bytes:
    rows: list[dict[str, Any]] = [{"kind": "summary", "payload": summary}]
    rows.extend({"kind": "event", "payload": event.model_dump(mode="json")} for event in events)
    rows.extend({"kind": "alert", "payload": alert.model_dump(mode="json")} for alert in alerts)
    rows.extend({"kind": "audit", "payload": _audit_payload(log)} for log in audit_logs)
    return ("\n".join(json.dumps(row, separators=(",", ":")) for row in rows) + "\n").encode()


def _html(summary: dict[str, Any]) -> str:
    counts = summary["counts"]
    return (
        '<!doctype html><html><head><meta charset="utf-8"><title>Cheeky Pony Report</title>'
        "</head><body><h1>Engagement Report</h1>"
        f"<p>Engagement: {escape(str(summary['engagement_name']))}</p>"
        f"<p>Window: {escape(str(summary['since']))} to {escape(str(summary['until']))}</p>"
        f"<ul><li>Events: {counts['events']}</li><li>Alerts: {counts['alerts']}</li>"
        f"<li>Audit logs: {counts['audit_logs']}</li></ul></body></html>"
    )


def _pdf(summary: dict[str, Any]) -> bytes:
    text = (
        "Cheeky Pony Engagement Report\n"
        f"Engagement: {summary['engagement_name']}\n"
        f"Window: {summary['since']} to {summary['until']}\n"
        f"Events: {summary['counts']['events']}\n"
        f"Alerts: {summary['counts']['alerts']}\n"
        f"Audit logs: {summary['counts']['audit_logs']}\n"
    )
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET"
    objects = [
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
        "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
        f"5 0 obj << /Length {len(stream)} >> stream\n{stream}\nendstream endobj",
    ]
    body = "\n".join(objects)
    return f"%PDF-1.4\n{body}\ntrailer << /Root 1 0 R >>\n%%EOF\n".encode()


def _empty_pcap() -> bytes:
    return bytes.fromhex("d4c3b2a1020004000000000000000000ffff000069000000")


def _audit_payload(log: AuditLog) -> dict[str, Any]:
    payload = log.model_dump(mode="json")
    payload.pop("raw_tool_output_ref", None)
    return payload
