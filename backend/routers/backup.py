from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.dependencies import TenantAccessContext, get_db, require_role
from core.responses import success_response
from models.user import Role
from services import backup as backup_service
from services.woocommerce import WooCommerceService


router = APIRouter(prefix="/api/tenants/{tenant_id}", tags=["backup"])


@router.post("/backup")
async def create_backup(context: TenantAccessContext = Depends(require_role(Role.CLIENT)), db: Session = Depends(get_db)):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await backup_service.create_backup(db, context.tenant, woo_service), status_code=201)


@router.get("/backups")
async def list_backups(context: TenantAccessContext = Depends(require_role(Role.CLIENT)), db: Session = Depends(get_db)):
    return success_response(backup_service.list_backups(db, context.tenant.id))


@router.get("/backups/{backup_id}")
async def download_backup(
    backup_id: UUID,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
    db: Session = Depends(get_db),
):
    filename, payload = backup_service.get_backup_file(db, context.tenant.id, backup_id)
    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename.name}"'},
    )
