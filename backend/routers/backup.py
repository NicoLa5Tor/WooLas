from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
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


@router.post("/backups/import")
async def import_backup(
    file: UploadFile = File(...),
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
    db: Session = Depends(get_db),
):
    return success_response(
        await backup_service.import_backup_file(db, context.tenant.id, file.filename, await file.read()),
        status_code=201,
    )


@router.post("/backups/{backup_id}/restore")
async def restore_backup(
    backup_id: UUID,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    job = backup_service.start_restore_job(
        tenant_id=context.tenant.id,
        backup_id=backup_id,
        credentials=context.credentials,
    )
    return success_response(job.model_dump(), status_code=202)


@router.get("/backups/restore-jobs/{job_id}")
async def get_restore_job(
    job_id: str,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    job = backup_service.get_restore_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Restore job not found")
    return success_response(job.model_dump())


@router.get("/backups")
async def list_backups(context: TenantAccessContext = Depends(require_role(Role.CLIENT)), db: Session = Depends(get_db)):
    return success_response(backup_service.list_backups(db, context.tenant.id))


@router.delete("/backups/{backup_id}")
async def delete_backup(
    backup_id: UUID,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
    db: Session = Depends(get_db),
):
    backup_service.delete_backup(db, context.tenant.id, backup_id)
    return success_response({"deleted": True})


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
