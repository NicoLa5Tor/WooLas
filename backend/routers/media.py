from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status

from core.dependencies import TenantAccessContext, require_role
from core.responses import success_response
from models.user import Role
from repositories import media_index as media_index_repository
from schemas.media import MediaResolvePayload
from services import imports as import_service
from services import media as media_service


router = APIRouter(prefix="/api/tenants/{tenant_id}/media", tags=["media"])


def _require_wp_credentials(context: TenantAccessContext):
    if context.wp_credentials is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este cliente no tiene configuradas las credenciales de WordPress para la galería de imágenes",
        )
    return context.wp_credentials


@router.get("")
async def get_media_library(
    page: int = Query(default=1, ge=1),
    search: str | None = None,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    data = media_service.get_media_library_from_index(
        context.db,
        context.tenant.id,
        page=page,
        per_page=50,
        search=search,
    )
    return success_response(data)


@router.get("/export")
async def export_media_excel(context: TenantAccessContext = Depends(require_role(Role.CLIENT))):
    media_records = media_index_repository.list_media_index_records(context.db, context.tenant.id)
    filename, file_bytes = import_service.build_media_export(media_records)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=file_bytes, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


@router.post("")
async def upload_media(
    file: UploadFile = File(...),
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    wp = _require_wp_credentials(context)
    file_bytes = await file.read()
    data = await media_service.upload_media(
        db=context.db,
        tenant_id=context.tenant.id,
        wp_url=context.tenant.wc_url,
        wp_user=wp["wp_user"],
        wp_app_password=wp["wp_app_password"],
        file_bytes=file_bytes,
        filename=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
    )
    return success_response(data, status_code=201)


@router.post("/sync")
async def start_media_sync(
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    wp = _require_wp_credentials(context)
    job = media_service.start_media_sync(
        tenant_id=context.tenant.id,
        wp_url=context.tenant.wc_url,
        wp_user=wp["wp_user"],
        wp_app_password=wp["wp_app_password"],
    )
    return success_response(job.model_dump(), status_code=202)


@router.get("/sync/{job_id}")
async def get_media_sync_status(
    job_id: str,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    job = media_service.get_media_sync_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync job not found")
    return success_response(job.model_dump())


@router.post("/purge")
async def start_media_purge(
    confirm: str = "",
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    if confirm != "BORRAR":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Falta confirmación. Envía confirm=BORRAR")
    wp = _require_wp_credentials(context)
    job = media_service.start_media_purge(
        tenant_id=context.tenant.id,
        wp_url=context.tenant.wc_url,
        wp_user=wp["wp_user"],
        wp_app_password=wp["wp_app_password"],
    )
    return success_response(job.model_dump(), status_code=202)


@router.get("/purge/{job_id}")
async def get_media_purge_status(
    job_id: str,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    job = media_service.get_media_purge_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purge job not found")
    return success_response(job.model_dump())


@router.post("/resolve")
async def resolve_media_names(
    payload: MediaResolvePayload,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    wp = _require_wp_credentials(context)
    indexed = media_service.resolve_media_by_names_from_index(db=context.db, tenant_id=context.tenant.id, names=payload.names)
    unresolved_names = [item["requested"] for item in indexed if not item["matched"]]
    if unresolved_names:
        fallback = await media_service.resolve_media_by_names_targeted(
            wp_url=context.tenant.wc_url,
            wp_user=wp["wp_user"],
            wp_app_password=wp["wp_app_password"],
            names=unresolved_names,
        )
        fallback_by_name = {item["requested"]: item for item in fallback}
        merged = [fallback_by_name.get(item["requested"], item) if not item["matched"] else item for item in indexed]
        matched_items = [item["item"] for item in fallback if item.get("matched") and item.get("item")]
        if matched_items:
            media_service.sync_media_index_records(context.db, context.tenant.id, matched_items, remove_missing=False)
            context.db.commit()
        data = merged
    else:
        data = indexed
    return success_response(data)
