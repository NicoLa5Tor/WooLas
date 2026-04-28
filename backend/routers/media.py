from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from core.config import settings
from core.dependencies import TenantAccessContext, require_role
from core.responses import success_response
from models.user import Role
from schemas.media import MediaResolvePayload
from services import media as media_service


router = APIRouter(prefix="/api/tenants/{tenant_id}/media", tags=["media"])


@router.get("")
async def get_media_library(
    page: int = Query(default=1, ge=1),
    search: str | None = None,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    wp_credentials = context.wp_credentials
    if wp_credentials is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este cliente no tiene configuradas las credenciales de WordPress para la galería de imágenes",
        )

    data = await media_service.get_media_library(
        db=context.db,
        tenant_id=context.tenant.id,
        wp_url=context.tenant.wc_url,
        wp_user=wp_credentials["wp_user"],
        wp_app_password=wp_credentials["wp_app_password"],
        page=page,
        search=search,
        cache_ttl_minutes=settings.media_cache_ttl_minutes,
    )
    return success_response(data)


@router.post("")
async def upload_media(
    file: UploadFile = File(...),
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    wp_credentials = context.wp_credentials
    if wp_credentials is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este cliente no tiene configuradas las credenciales de WordPress para la galería de imágenes",
        )

    file_bytes = await file.read()
    data = await media_service.upload_media(
        db=context.db,
        tenant_id=context.tenant.id,
        wp_url=context.tenant.wc_url,
        wp_user=wp_credentials["wp_user"],
        wp_app_password=wp_credentials["wp_app_password"],
        file_bytes=file_bytes,
        filename=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
    )
    return success_response(data, status_code=201)


@router.post("/resolve")
async def resolve_media_names(
    payload: MediaResolvePayload,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    wp_credentials = context.wp_credentials
    if wp_credentials is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este cliente no tiene configuradas las credenciales de WordPress para la galería de imágenes",
        )

    indexed = media_service.resolve_media_by_names_from_index(db=context.db, tenant_id=context.tenant.id, names=payload.names)
    unresolved_names = [item["requested"] for item in indexed if not item["matched"]]
    if unresolved_names:
        fallback = await media_service.resolve_media_by_names(
            wp_url=context.tenant.wc_url,
            wp_user=wp_credentials["wp_user"],
            wp_app_password=wp_credentials["wp_app_password"],
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
