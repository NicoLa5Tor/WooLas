from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TenantCreate(BaseModel):
    name: str
    wc_url: str
    wc_key: str
    wc_secret: str
    wp_user: str | None = None
    wp_app_password: str | None = None
    is_active: bool = True


class TenantUpdate(BaseModel):
    name: str | None = None
    wc_url: str | None = None
    wc_key: str | None = None
    wc_secret: str | None = None
    wp_user: str | None = None
    wp_app_password: str | None = None
    is_active: bool | None = None


class TenantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    wc_url: str
    wp_user: str | None = None
    has_wp_media_credentials: bool = False
    is_active: bool
    created_at: datetime
