# SPDX-License-Identifier: AGPL-3.0-only
"""Environment-backed settings for the Cheeky Pony backend."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-change-me-dev-only-change-me"  # noqa: S105  # nosec B105
DEV_SEED_ADMIN_PASSWORD = "change-me-now"  # noqa: S105  # nosec B105


class Settings(BaseSettings):
    """Backend runtime settings read from environment variables."""

    model_config = SettingsConfigDict(env_prefix="CHEEKY_PONY_", env_file=".env", extra="ignore")

    env: str = "dev"
    lab_mode: bool = False
    mongo_dsn: str = "mongodb://localhost:27017"
    mongo_db: str = "cheeky_pony"
    redis_dsn: str = "redis://localhost:6379/0"
    jwt_secret: str = Field(min_length=32, default=DEV_JWT_SECRET)
    jwt_issuer: str = "cheeky-pony"
    access_token_minutes: int = Field(default=30, ge=1, le=1440)
    refresh_token_days: int = Field(default=7, ge=1, le=60)
    cookie_secure: bool = True
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = DEV_SEED_ADMIN_PASSWORD
    bootstrap_token: str | None = Field(default=None, min_length=16)
    use_in_memory_store: bool = False
    report_download_token_minutes: int = Field(default=15, ge=1, le=1440)
    pcap_max_upload_mb: int = Field(default=100, ge=1, le=500)
    totp_recent_minutes: int = Field(default=15, ge=1, le=120)
    label_confidence_threshold: float = Field(default=0.6, ge=0.0, le=1.0)
    sensor_gateway_header_secret: str | None = Field(default=None, min_length=32)
    sensor_gateway_header_skew_seconds: int = Field(default=300, ge=30, le=3600)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors_origins(cls, value: object) -> object:
        """Parse comma-separated CORS origins from environment variables.

        Args:
            value: Raw settings value.

        Returns:
            Parsed list or original value.
        """

        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def no_wildcard_origin(cls, value: list[str]) -> list[str]:
        """Reject wildcard or empty origins while credentialed CORS is enabled.

        Args:
            value: Parsed CORS origin list.

        Returns:
            Validated origin list.
        """

        if any(origin.strip() in {"", "*"} for origin in value):
            msg = "cors_origins must not contain '*' or an empty entry when cookies are enabled"
            raise ValueError(msg)
        return value

    @model_validator(mode="after")
    def reject_production_defaults(self) -> Settings:
        """Reject known development secrets in production-like environments.

        Returns:
            Validated settings.
        """

        if self.env.lower() in {"dev", "test", "dast", "local"}:
            return self
        if self.jwt_secret == DEV_JWT_SECRET:
            msg = "CHEEKY_PONY_JWT_SECRET must be set outside development"
            raise ValueError(msg)
        if self.seed_admin_password == DEV_SEED_ADMIN_PASSWORD:
            msg = "CHEEKY_PONY_SEED_ADMIN_PASSWORD must be set outside development"
            raise ValueError(msg)
        if self.sensor_gateway_header_secret is None:
            msg = "CHEEKY_PONY_SENSOR_GATEWAY_HEADER_SECRET must be set outside development"
            raise ValueError(msg)
        return self


@lru_cache
def get_settings() -> Settings:
    """Return cached backend settings.

    Returns:
        Settings instance.
    """

    return Settings()
