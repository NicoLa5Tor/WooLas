from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.config import settings
from core.security import create_access_token, hash_password, verify_password
from models.user import Role, User
from repositories import tenant as tenant_repository
from repositories import user as user_repository
from schemas.auth import MeResponse
from schemas.tenant import TenantRead
from schemas.user import UserRead, UserTenantMembershipRead


def _serialize_user(user: User) -> UserRead:
    effective_role = Role.ADMIN if user.is_superadmin else (user.tenant_memberships[0].role if user.tenant_memberships else None)
    memberships = [
        UserTenantMembershipRead(
            tenant_id=membership.tenant_id,
            tenant_name=membership.tenant.name if membership.tenant else "",
            role=membership.role,
        )
        for membership in user.tenant_memberships
    ]
    return UserRead(
        id=user.id,
        email=user.email,
        username=user.username,
        role=effective_role,
        is_superadmin=user.is_superadmin,
        is_active=user.is_active,
        created_at=user.created_at,
        last_login=user.last_login,
        memberships=memberships,
    )


def build_me_response(db: Session, user: User) -> MeResponse:
    tenants = user_repository.list_tenants_for_user(db, user.id) if not user.is_superadmin else tenant_repository.list_tenants(db)
    return MeResponse(
        user=_serialize_user(user),
        tenants=[TenantRead.model_validate(tenant) for tenant in tenants],
    )


def login_user(db: Session, username: str, password: str) -> tuple[MeResponse, str]:
    user = user_repository.get_user_by_username(db, username)
    if not user or not user.is_active or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    user.last_login = datetime.utcnow()
    user_repository.update_user(db, user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    me = build_me_response(db, user)
    return me, token


def logout_user() -> None:
    return None


def seed_startup(db: Session) -> None:
    if user_repository.count_superadmins(db) == 0:
        user_repository.create_user(
            db,
            email=f"{settings.admin_username}@woolas.local",
            username=settings.admin_username,
            hashed_password=hash_password(settings.admin_password),
            is_superadmin=True,
            is_active=True,
        )
    db.commit()
