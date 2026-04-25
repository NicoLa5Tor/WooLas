from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.dependencies import TenantAccessContext, get_db, require_admin, require_role
from core.responses import success_response
from models.user import Role
from schemas.user import AdminClientCreate, AdminClientUpdate, UserCreate, UserUpdate
from services import user as user_service


router = APIRouter(prefix="/api/tenants/{tenant_id}/users", tags=["users"])
admin_router = APIRouter(prefix="/api/admin/clients", tags=["admin-clients"])


@router.get("")
async def list_users(context: TenantAccessContext = Depends(require_role(Role.ADMIN)), db: Session = Depends(get_db)):
    return success_response(user_service.list_users_for_tenant(db, context.tenant.id))


@router.post("")
async def create_user(payload: UserCreate, context: TenantAccessContext = Depends(require_role(Role.ADMIN)), db: Session = Depends(get_db)):
    return success_response(user_service.create_user_for_tenant(db, context.tenant.id, payload), status_code=201)


@router.patch("/{user_id}")
async def update_user(
    user_id: UUID,
    payload: UserUpdate,
    context: TenantAccessContext = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    return success_response(user_service.update_user_for_tenant(db, context.tenant.id, user_id, payload, context.user))


@admin_router.get("")
async def list_admin_clients(_: object = Depends(require_admin), db: Session = Depends(get_db)):
    return success_response(user_service.list_admin_clients(db))


@admin_router.post("")
async def create_admin_client(payload: AdminClientCreate, _: object = Depends(require_admin), db: Session = Depends(get_db)):
    return success_response(user_service.create_admin_client(db, payload), status_code=201)


@admin_router.patch("/{user_id}")
async def update_admin_client(user_id: UUID, payload: AdminClientUpdate, _: object = Depends(require_admin), db: Session = Depends(get_db)):
    return success_response(user_service.update_admin_client(db, user_id, payload))
