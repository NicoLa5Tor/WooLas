from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from models.user import Role


class UserCreate(BaseModel):
    email: str | None = None
    username: str
    password: str
    role: Role = Role.CLIENT


class UserUpdate(BaseModel):
    password: str | None = None
    is_active: bool | None = None
    role: Role | None = None


class UserTenantMembershipRead(BaseModel):
    tenant_id: UUID
    tenant_name: str
    role: Role


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str | None = None
    username: str
    role: Role | None = None
    is_superadmin: bool
    is_active: bool
    created_at: datetime
    last_login: datetime | None
    memberships: list[UserTenantMembershipRead] = Field(default_factory=list)


class AdminClientCreate(BaseModel):
    name: str
    email: str
    username: str
    password: str
    wc_url: str
    wc_key: str
    wc_secret: str
    is_active: bool = True


class AdminClientUpdate(BaseModel):
    email: str | None = None
    username: str | None = None
    password: str | None = None
    is_active: bool | None = None
    tenant_name: str | None = None
    wc_url: str | None = None
    wc_key: str | None = None
    wc_secret: str | None = None


class AdminClientRead(BaseModel):
    id: UUID
    email: str | None = None
    username: str
    role: Role
    is_active: bool
    created_at: datetime
    last_login: datetime | None
    tenant_id: UUID
    tenant_name: str
    wc_url: str
