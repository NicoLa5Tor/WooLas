from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from core.config import settings
from core.dependencies import TenantAccessContext, require_role
from core.responses import success_response
from models.user import Role
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
