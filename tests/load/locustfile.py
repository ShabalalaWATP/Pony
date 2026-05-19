# SPDX-License-Identifier: AGPL-3.0-only
"""Locust profile for the backend HTTP and operator WebSocket paths."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from functools import lru_cache
from itertools import count
from threading import Lock

import pyotp
from locust import HttpUser, between, constant, task
from locust.exception import StopUser
from websocket import WebSocket, WebSocketException, WebSocketTimeoutException, create_connection

API_PREFIX = "/api/v1"
DEFAULT_ORIGIN = "http://localhost:5173"
_SESSION_LOCK = Lock()
_SESSION: SessionState | None = None
_SEQUENCE = count()


@dataclass(frozen=True)
class LoadConfig:
    """Environment-driven load-test settings."""

    email: str
    password: str
    csrf_token: str | None
    origin: str
    access_token: str | None
    refresh_token: str | None
    totp_secret: str | None


@dataclass(frozen=True)
class SessionState:
    """Reusable authenticated browser-session state."""

    cookies: dict[str, str]
    csrf_token: str
    totp_verified: bool


class BackendUser(HttpUser):
    """Base user that authenticates against the backend once per process."""

    abstract = True
    csrf_token: str
    admin_ready: bool

    def on_start(self) -> None:
        """Authenticate this Locust user before running tasks."""

        state = _session_state(self)
        self.client.cookies.update(state.cookies)
        self.csrf_token = state.csrf_token
        self.admin_ready = state.totp_verified

    def csrf_headers(self) -> dict[str, str]:
        """Return headers for CSRF-protected mutations."""

        return {"x-csrf-token": self.csrf_token}


class LoginUser(BackendUser):
    """Exercise login, refresh, and low-cost authenticated reads."""

    fixed_count = 1
    wait_time = between(10, 15)

    @task(2)
    def refresh_session(self) -> None:
        """Refresh the browser session and update CSRF state."""

        response = self.client.post(f"{API_PREFIX}/auth/refresh", name="/api/v1/auth/refresh")
        if response.status_code == 200:
            self.csrf_token = str(response.json()["csrf_token"])

    @task
    def read_session_backed_status(self) -> None:
        """Read cheap authenticated endpoints after login."""

        self.client.get(f"{API_PREFIX}/system/demo-status", name="/api/v1/system/demo-status")
        self.client.get(f"{API_PREFIX}/engagements", name="/api/v1/engagements")


class ListReader(BackendUser):
    """Page through dashboard read models at a steady rate."""

    weight = 8
    wait_time = constant(1)

    def on_start(self) -> None:
        """Authenticate and initialise paging state."""

        super().on_start()
        self._offset = next(_SEQUENCE) % 5 * 100

    @task
    def list_pages(self) -> None:
        """Read the AP, client, event, alert, engagement, and audit lists."""

        params = {"limit": 100, "offset": self._offset}
        self.client.get(f"{API_PREFIX}/access_points", params=params, name="/api/v1/access_points")
        self.client.get(f"{API_PREFIX}/devices", params=params, name="/api/v1/devices")
        self.client.get(f"{API_PREFIX}/events", params=params, name="/api/v1/events")
        self.client.get(f"{API_PREFIX}/alerts", params=params, name="/api/v1/alerts")
        self.client.get(f"{API_PREFIX}/engagements", params=params, name="/api/v1/engagements")
        if self.admin_ready:
            self.client.get(f"{API_PREFIX}/audit", params=params, name="/api/v1/audit")
        self._offset = 0 if self._offset >= 400 else self._offset + 100


class WsListener(BackendUser):
    """Hold an operator WebSocket open and record receive latency."""

    weight = 6
    wait_time = constant(1)

    def on_start(self) -> None:
        """Authenticate and connect to the operator WebSocket."""

        super().on_start()
        self._ws: WebSocket | None = None
        self._connect_ws()

    @task
    def receive_operator_broadcast(self) -> None:
        """Receive one operator message or record an idle interval."""

        if self._ws is None:
            self._connect_ws()
        if self._ws is None:
            return
        started_at = time.perf_counter()
        try:
            message = self._ws.recv()
        except WebSocketTimeoutException:
            _record_ws_request(self, "/ws/operator idle", started_at, 0, None)
            return
        except WebSocketException as exc:
            _record_ws_request(self, "/ws/operator recv", started_at, 0, exc)
            self._close_ws()
            return
        _record_ws_request(self, "/ws/operator recv", started_at, len(str(message)), None)

    def on_stop(self) -> None:
        """Close the operator WebSocket when Locust stops this user."""

        self._close_ws()

    def _connect_ws(self) -> None:
        config = _load_config()
        started_at = time.perf_counter()
        try:
            self._ws = create_connection(
                _operator_ws_url(self.host),
                cookie=_cookie_header(self.client.cookies.get_dict()),
                origin=config.origin,
                timeout=5,
            )
            self._ws.settimeout(2)
        except WebSocketException as exc:
            self._ws = None
            _record_ws_request(self, "/ws/operator connect", started_at, 0, exc)
            return
        _record_ws_request(self, "/ws/operator connect", started_at, 0, None)

    def _close_ws(self) -> None:
        if self._ws is None:
            return
        try:
            self._ws.close()
        finally:
            self._ws = None


class LabAdmin(BackendUser):
    """Run one low-rate engagement lifecycle loop."""

    fixed_count = 1
    wait_time = between(12, 20)

    def on_start(self) -> None:
        """Require a verified admin session for mutation load."""

        super().on_start()
        if not self.admin_ready:
            raise StopUser()

    @task
    def engagement_lifecycle(self) -> None:
        """Create an engagement, add targets, and end it."""

        name = f"load-{int(time.time() * 1000)}-{next(_SEQUENCE)}"
        created = self.client.post(
            f"{API_PREFIX}/engagements",
            json={"name": name, "scope_rules": [{"kind": "load-test", "value": name}]},
            headers=self.csrf_headers(),
            name="/api/v1/engagements create",
        )
        if created.status_code != 200:
            return
        engagement_id = str(created.json()["id"])
        for target in _allow_targets():
            self.client.post(
                f"{API_PREFIX}/engagements/{engagement_id}/allow-list",
                json=target,
                headers=self.csrf_headers(),
                name="/api/v1/engagements/{id}/allow-list",
            )
        self.client.post(
            f"{API_PREFIX}/engagements/{engagement_id}/end",
            headers=self.csrf_headers(),
            name="/api/v1/engagements/{id}/end",
        )


def _session_state(user: HttpUser) -> SessionState:
    global _SESSION
    with _SESSION_LOCK:
        if _SESSION is None:
            _SESSION = _build_session(user)
        return _SESSION


def _build_session(user: HttpUser) -> SessionState:
    config = _load_config()
    if config.access_token is not None and config.csrf_token is not None:
        cookies = {"access_token": config.access_token, "csrf_token": config.csrf_token}
        if config.refresh_token is not None:
            cookies["refresh_token"] = config.refresh_token
        return SessionState(cookies=cookies, csrf_token=config.csrf_token, totp_verified=False)
    if not config.email or not config.password:
        raise StopUser()
    login = user.client.post(
        f"{API_PREFIX}/auth/login",
        json={"email": config.email, "password": config.password},
        name="/api/v1/auth/login setup",
    )
    if login.status_code != 200:
        raise StopUser()
    csrf_token = str(login.json()["csrf_token"])
    totp_verified = _verify_totp(user, config, csrf_token)
    return SessionState(
        cookies=user.client.cookies.get_dict(),
        csrf_token=csrf_token,
        totp_verified=totp_verified,
    )


def _verify_totp(user: HttpUser, config: LoadConfig, csrf_token: str) -> bool:
    if config.totp_secret is None:
        return False
    response = user.client.post(
        f"{API_PREFIX}/auth/2fa/verify",
        json={"code": pyotp.TOTP(config.totp_secret).now()},
        headers={"x-csrf-token": csrf_token},
        name="/api/v1/auth/2fa/verify setup",
    )
    return response.status_code == 200


@lru_cache
def _load_config() -> LoadConfig:
    return LoadConfig(
        email=os.getenv("CHEEKY_PONY_LOAD_EMAIL", ""),
        password=os.getenv("CHEEKY_PONY_LOAD_PASSWORD", ""),
        csrf_token=os.getenv("CHEEKY_PONY_LOAD_CSRF_TOKEN"),
        origin=os.getenv("CHEEKY_PONY_LOAD_ORIGIN", DEFAULT_ORIGIN),
        access_token=os.getenv("CHEEKY_PONY_LOAD_ACCESS_TOKEN"),
        refresh_token=os.getenv("CHEEKY_PONY_LOAD_REFRESH_TOKEN"),
        totp_secret=os.getenv("CHEEKY_PONY_LOAD_TOTP_SECRET"),
    )


def _operator_ws_url(host: str) -> str:
    normalized = host.rstrip("/")
    if normalized.startswith("https://"):
        return "wss://" + normalized.removeprefix("https://") + "/ws/operator"
    if normalized.startswith("http://"):
        return "ws://" + normalized.removeprefix("http://") + "/ws/operator"
    return "ws://" + normalized + "/ws/operator"


def _cookie_header(cookies: dict[str, str]) -> str:
    return "; ".join(f"{name}={value}" for name, value in cookies.items())


def _record_ws_request(
    user: HttpUser,
    name: str,
    started_at: float,
    response_length: int,
    exception: Exception | None,
) -> None:
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    user.environment.events.request.fire(
        request_type="WS",
        name=name,
        response_time=elapsed_ms,
        response_length=response_length,
        exception=exception,
    )


def _allow_targets() -> list[dict[str, str]]:
    suffix = next(_SEQUENCE) % 16_777_215
    return [
        {"kind": "bssid", "value": f"02:00:{suffix >> 16 & 255:02X}:AA:00:01"},
        {"kind": "bssid", "value": f"02:00:{suffix >> 8 & 255:02X}:AA:00:02"},
        {"kind": "client_mac", "value": f"02:00:{suffix & 255:02X}:BB:00:03"},
    ]
