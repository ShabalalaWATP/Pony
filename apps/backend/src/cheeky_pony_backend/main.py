# SPDX-License-Identifier: AGPL-3.0-only
"""FastAPI application factory for the Cheeky Pony backend."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import uvicorn
from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cheeky_pony_backend.api.v1 import (
    alerts,
    audit,
    auth,
    devices,
    engagements,
    lab,
    reports,
    sensors,
    system,
)
from cheeky_pony_backend.api.ws import router as ws_router
from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.domain.active_gates import ActiveGateDeniedError
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.infra.mongo_store import MongoStore
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.infra.sensor_command_broker import SensorCommandBroker
from cheeky_pony_backend.logging import configure_logging
from cheeky_pony_backend.security import CsrfService, TokenService


def create_app(settings: Settings | None = None, store: Store | None = None) -> FastAPI:
    """Create and configure the FastAPI app.

    Args:
        settings: Optional settings override.
        store: Optional store override.

    Returns:
        Configured FastAPI application.
    """

    configure_logging()
    active_settings = settings or get_settings()
    active_store = store or _create_store(active_settings)
    app = FastAPI(title="Cheeky Pony API", version="0.1.0")
    app.state.settings = active_settings
    app.state.store = active_store
    app.state.operator_broker = OperatorBroker()
    app.state.sensor_command_broker = SensorCommandBroker()
    app.dependency_overrides[get_settings] = lambda: active_settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
    )
    _install_exception_handlers(app)
    _install_security_middleware(app, active_settings)
    _install_routes(app)

    @app.on_event("startup")
    async def _startup() -> None:
        await active_store.ensure_indexes()

    return app


def run() -> None:
    """Run the ASGI server with Uvicorn."""

    uvicorn.run(  # noqa: S104
        "cheeky_pony_backend.main:create_app",
        factory=True,
        host="0.0.0.0",  # noqa: S104  # nosec B104
        port=8000,
    )


def _create_store(settings: Settings) -> Store:
    if settings.use_in_memory_store or settings.env == "test":
        return InMemoryStore()
    return MongoStore(settings.mongo_dsn, settings.mongo_db)


def _install_routes(app: FastAPI) -> None:
    @app.get("/health")
    async def health() -> dict[str, str]:
        """Return process health.

        Returns:
            Health status payload.
        """

        return {"status": "ok"}

    @app.get("/metrics")
    async def metrics() -> Response:
        """Return Prometheus-style metrics.

        Returns:
            Plain-text metrics response.
        """

        return Response("cheeky_pony_up 1\n", media_type="text/plain")

    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(sensors.router, prefix="/api/v1")
    app.include_router(devices.router, prefix="/api/v1")
    app.include_router(alerts.router, prefix="/api/v1")
    app.include_router(lab.router, prefix="/api/v1")
    app.include_router(reports.router, prefix="/api/v1")
    app.include_router(audit.router, prefix="/api/v1")
    app.include_router(system.router, prefix="/api/v1")
    app.include_router(engagements.router, prefix="/api/v1")
    app.include_router(ws_router)


def _install_security_middleware(app: FastAPI, settings: Settings) -> None:
    @app.middleware("http")
    async def security_headers_and_csrf(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        csrf_response = _csrf_failure_response(request, settings)
        if csrf_response is not None:
            return csrf_response
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        return response


def _csrf_failure_response(request: Request, settings: Settings) -> Response | None:
    unsafe = request.method in {"POST", "PUT", "PATCH", "DELETE"}
    exempt = request.url.path in {
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/refresh",
    }
    if not unsafe or exempt or not request.url.path.startswith("/api/"):
        return None
    token = request.cookies.get("access_token")
    if not token:
        return None
    try:
        claims = TokenService(settings).verify(token, "access")
    except Exception:
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)
    csrf_header = request.headers.get("x-csrf-token")
    if not CsrfService().verify(str(claims.get("csrf")), csrf_header):
        return Response(status_code=status.HTTP_403_FORBIDDEN)
    return None


def _install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ActiveGateDeniedError)
    async def active_gate_denied(_: Request, exc: ActiveGateDeniedError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"reason": exc.reason, "detail": exc.detail},
        )


if __name__ == "__main__":
    run()
