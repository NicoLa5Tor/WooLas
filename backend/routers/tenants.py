from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.dependencies import get_db, require_admin
from core.responses import success_response
from schemas.tenant import TenantCreate, TenantUpdate
from services import tenant as tenant_service


router = APIRouter(prefix="/api/tenants", tags=["tenants"])


@router.get("")
async def list_tenants(_: object = Depends(require_admin), db: Session = Depends(get_db)):
    return success_response(tenant_service.list_tenants(db))


@router.post("")
async def create_tenant(payload: TenantCreate, _: object = Depends(require_admin), db: Session = Depends(get_db)):
    return success_response(tenant_service.create_tenant(db, payload), status_code=201)


@router.get("/{tenant_id}")
async def get_tenant(tenant_id: UUID, _: object = Depends(require_admin), db: Session = Depends(get_db)):
    return success_response(tenant_service.get_tenant(db, tenant_id))


@router.patch("/{tenant_id}")
async def update_tenant(tenant_id: UUID, payload: TenantUpdate, _: object = Depends(require_admin), db: Session = Depends(get_db)):
    return success_response(tenant_service.update_tenant(db, tenant_id, payload))
