from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "WooLas"
    frontend_origin: str = Field(default="http://localhost:3000", alias="FRONTEND_ORIGIN")
    next_public_api_url: str = Field(default="http://localhost:8000", alias="NEXT_PUBLIC_API_URL")

    jwt_secret: str = Field(alias="JWT_SECRET")
    access_token_expire_hours: int = 8
    access_cookie_name: str = "access_token"
    jwt_algorithm: str = "HS256"

    admin_username: str = Field(alias="ADMIN_USERNAME")
    admin_password: str = Field(alias="ADMIN_PASSWORD")

    fernet_key: str = Field(alias="FERNET_KEY")

    database_url: str = Field(alias="DATABASE_URL")
    backups_dir: Path = Field(default=Path("/backups"), alias="BACKUPS_DIR")
    media_cache_ttl_minutes: int = Field(default=15, alias="MEDIA_CACHE_TTL_MINUTES")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def ensure_storage_dirs() -> None:
    settings.backups_dir.mkdir(parents=True, exist_ok=True)


settings = get_settings()
