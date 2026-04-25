from pydantic import BaseModel

from schemas.tenant import TenantRead
from schemas.user import UserRead


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    user: UserRead
    tenants: list[TenantRead]


class MeResponse(BaseModel):
    user: UserRead
    tenants: list[TenantRead]
