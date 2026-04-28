from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.dependencies import TenantAccessContext, get_db, require_recent_backup, require_role
from core.responses import success_response
from models.user import Role
from schemas.imports import ImportRefactorPayload
from services import imports as import_service
from services.woocommerce import WooCommerceService


router = APIRouter(prefix="/api/tenants/{tenant_id}/imports", tags=["imports"])


def _parse_selected_fields(selected_fields: str) -> list[str]:
    try:
        parsed = json.loads(selected_fields)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Las columnas seleccionadas no tienen un formato valido") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Las columnas seleccionadas deben enviarse como una lista")
    return parsed


def _parse_selected_row_indexes(selected_row_indexes: str | None) -> list[int] | None:
    if selected_row_indexes is None or not selected_row_indexes.strip():
        return None
    try:
        parsed = json.loads(selected_row_indexes)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Las filas seleccionadas no tienen un formato valido") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, int) for item in parsed):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Las filas seleccionadas deben enviarse como una lista de enteros")
    return parsed


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
    selected_fields: str = Form(...),
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    return success_response(
        await import_service.preview_import_draft(
            db=context.db,
            tenant_id=context.tenant.id,
            selected_fields=_parse_selected_fields(selected_fields),
            products=context.backup_record.payload,
        )
    )


@router.post("/apply")
async def apply_import_draft(
    selected_fields: str = Form(...),
    selected_row_indexes: str | None = Form(default=None),
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(
        await import_service.apply_import_draft(
            db=context.db,
            tenant_id=context.tenant.id,
            selected_fields=_parse_selected_fields(selected_fields),
            selected_row_indexes=_parse_selected_row_indexes(selected_row_indexes),
            products=context.backup_record.payload,
            backup_record=context.backup_record,
            woo_service=woo_service,
            credentials=context.credentials,
            wp_url=context.tenant.wc_url,
            wp_user=None if context.wp_credentials is None else context.wp_credentials["wp_user"],
            wp_app_password=None if context.wp_credentials is None else context.wp_credentials["wp_app_password"],
        )
    )


@router.get("/apply-jobs/{job_id}")
async def get_apply_import_job_status(
    job_id: str,
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    return success_response(await import_service.get_import_apply_job_status(job_id=job_id))


@router.post("/refactor")
async def refactor_import_draft(
    payload: ImportRefactorPayload,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
    db: Session = Depends(get_db),
):
    return success_response(
        import_service.refactor_import_draft(
            db=db,
            tenant_id=context.tenant.id,
            user_id=context.user.id,
            mapping=payload.mapping,
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
