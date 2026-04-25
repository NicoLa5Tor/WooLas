from dataclasses import dataclass
from uuid import UUID

from fastapi import Cookie, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from core.config import settings
from core.security import decode_access_token
from models.tenant import Tenant, UserTenant
from models.user import Role, User
from repositories import tenant as tenant_repository
from repositories import user as user_repository
from services import backup as backup_service
from services.tenant import get_decrypted_credentials


def get_db():
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    access_token: str | None = Cookie(default=None, alias=settings.access_cookie_name),
    db: Session = Depends(get_db),
) -> User:
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    payload = decode_access_token(access_token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token")

    user = user_repository.get_user_by_id(db, UUID(user_id))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is not available")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


@dataclass
class TenantAccessContext:
    db: Session
    user: User
    tenant: Tenant
    membership: UserTenant | None
    credentials: dict[str, str]
    backup_record: object | None = None


def get_tenant_context(
    tenant_id: UUID = Path(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TenantAccessContext:
    tenant = tenant_repository.get_tenant_by_id(db, tenant_id)
    if not tenant or not tenant.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    membership = user_repository.get_user_tenant_membership(db, current_user.id, tenant_id)
    if not current_user.is_superadmin and membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not belong to this tenant")

    if membership is not None and membership.role == Role.SUPERADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid tenant membership role")

    return TenantAccessContext(
        db=db,
        user=current_user,
        tenant=tenant,
        membership=membership,
        credentials=get_decrypted_credentials(tenant),
        backup_record=None,
    )


def require_role(role: Role):
    hierarchy = {Role.CLIENT: 1, Role.ADMIN: 2}

    def dependency(context: TenantAccessContext = Depends(get_tenant_context)) -> TenantAccessContext:
        if context.user.is_superadmin:
            return context

        membership = context.membership
        if membership is None or hierarchy.get(membership.role, 0) < hierarchy.get(role, 0):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient tenant permissions")
        return context

    return dependency


def require_recent_backup(role: Role):
    hierarchy = {Role.CLIENT: 1, Role.ADMIN: 2}

    def dependency(context: TenantAccessContext = Depends(get_tenant_context)) -> TenantAccessContext:
        if not context.user.is_superadmin:
            membership = context.membership
            if membership is None or hierarchy.get(membership.role, 0) < hierarchy.get(role, 0):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient tenant permissions")

        context.backup_record = backup_service.require_fresh_backup(context.db, context.tenant.id)
        return context

    return dependency


def get_default_tenant_context(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TenantAccessContext:
    if current_user.is_superadmin:
        tenant = tenant_repository.list_tenants(db)[0] if tenant_repository.list_tenants(db) else None
    else:
        membership = next((membership for membership in current_user.tenant_memberships if membership.tenant and membership.tenant.is_active), None)
        tenant = membership.tenant if membership else None

    if tenant is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant is available for this user")

    return get_tenant_context(tenant.id, current_user, db)


def require_default_role(role: Role):
    hierarchy = {Role.CLIENT: 1, Role.ADMIN: 2}

    def dependency(context: TenantAccessContext = Depends(get_default_tenant_context)) -> TenantAccessContext:
        if context.user.is_superadmin:
            return context

        membership = context.membership
        if membership is None or hierarchy.get(membership.role, 0) < hierarchy.get(role, 0):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient tenant permissions")
        return context

    return dependency
