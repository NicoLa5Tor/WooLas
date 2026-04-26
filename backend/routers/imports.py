from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.dependencies import TenantAccessContext, get_db, require_recent_backup, require_role
from core.responses import success_response
from models.user import Role
from services import imports as import_service
from services.woocommerce import WooCommerceService


router = APIRouter(prefix="/api/tenants/{tenant_id}/imports", tags=["imports"])


@router.post("")
async def upload_import_draft(
    file: UploadFile = File(...),
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
    db: Session = Depends(get_db),
):
    data = import_service.save_import_draft(
        db,
        tenant_id=context.tenant.id,
        user_id=context.user.id,
        filename=file.filename or "import.xlsx",
        file_bytes=await file.read(),
    )
    return success_response(data, status_code=201)


@router.get("/current")
async def get_current_import_draft(context: TenantAccessContext = Depends(require_role(Role.CLIENT)), db: Session = Depends(get_db)):
    return success_response(import_service.get_current_import_draft(db, context.tenant.id))


@router.get("/current/download")
async def download_current_import_draft(context: TenantAccessContext = Depends(require_role(Role.CLIENT)), db: Session = Depends(get_db)):
    draft, file_bytes = import_service.get_current_import_draft_bytes(db, context.tenant.id)
    headers = {"Content-Disposition": f'attachment; filename="{draft["original_filename"]}"'}
    return Response(content=file_bytes, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


@router.get("/template")
async def download_import_template(context: TenantAccessContext = Depends(require_role(Role.CLIENT))):
    filename, file_bytes = import_service.build_import_template()
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=file_bytes, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


@router.post("/preview")
async def preview_import_draft(
    id_column: str = Form(...),
    value_column: str = Form(...),
    id_type: str = Form(...),
    wc_field: str = Form(...),
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    return success_response(
        await import_service.preview_import_draft(
            db=context.db,
            tenant_id=context.tenant.id,
            id_column=id_column,
            value_column=value_column,
            id_type=id_type,
            wc_field=wc_field,
            products=context.backup_record.payload,
        )
    )


@router.post("/apply")
async def apply_import_draft(
    id_column: str = Form(...),
    value_column: str = Form(...),
    id_type: str = Form(...),
    wc_field: str = Form(...),
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(
        await import_service.apply_import_draft(
            db=context.db,
            tenant_id=context.tenant.id,
            id_column=id_column,
            value_column=value_column,
            id_type=id_type,
            wc_field=wc_field,
            products=context.backup_record.payload,
            backup_record=context.backup_record,
            woo_service=woo_service,
        )
    )


@router.get("/{draft_id}")
async def get_import_draft(
    draft_id: UUID,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
    db: Session = Depends(get_db),
):
    return success_response(import_service.get_current_import_draft(db, context.tenant.id) if False else import_service.get_import_draft(db, context.tenant.id, draft_id))


@router.delete("/{draft_id}")
async def delete_import_draft(
    draft_id: UUID,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
    db: Session = Depends(get_db),
):
    draft = import_service.get_import_draft(db, context.tenant.id, draft_id)
    import_service.delete_import_draft(db, context.tenant.id)
    return success_response({"deleted": str(draft.id)})
