# SPDX-License-Identifier: AGPL-3.0-only
"""Environment-backed settings for the Cheeky Pony backend."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend runtime settings read from environment variables."""

    model_config = SettingsConfigDict(env_prefix="CHEEKY_PONY_", env_file=".env", extra="ignore")

    env: str = "dev"
    lab_mode: bool = False
    mongo_dsn: str = "mongodb://localhost:27017"
    mongo_db: str = "cheeky_pony"
    redis_dsn: str = "redis://localhost:6379/0"
    jwt_secret: str = Field(min_length=32, default="dev-only-change-me-dev-only-change-me")
    jwt_issuer: str = "cheeky-pony"
    access_token_minutes: int = Field(default=30, ge=1, le=1440)
    refresh_token_days: int = Field(default=7, ge=1, le=60)
    cookie_secure: bool = True
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "change-me-now"  # noqa: S105
    use_in_memory_store: bool = False
    report_download_token_minutes: int = Field(default=15, ge=1, le=1440)

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


@lru_cache
def get_settings() -> Settings:
    """Return cached backend settings.

    Returns:
        Settings instance.
    """

    return Settings()
