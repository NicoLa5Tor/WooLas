from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.security import decrypt_secret, encrypt_secret
from repositories import tenant as tenant_repository
from schemas.tenant import TenantCreate, TenantRead, TenantUpdate


def _serialize_tenant(tenant) -> dict:
    return TenantRead(
        id=tenant.id,
        name=tenant.name,
        wc_url=tenant.wc_url,
        wp_user=tenant.wp_user,
        has_wp_media_credentials=bool(tenant.wp_user and tenant.wp_app_password),
        is_active=tenant.is_active,
        created_at=tenant.created_at,
    ).model_dump(mode="json")


def create_tenant_internal(
    db: Session,
    *,
    name: str,
    wc_url: str,
    wc_key: str,
    wc_secret: str,
    wp_user: str | None,
    wp_app_password: str | None,
    is_active: bool,
):
    return tenant_repository.create_tenant(
        db,
        name=name,
        wc_url=wc_url,
        wc_key=encrypt_secret(wc_key),
        wc_secret=encrypt_secret(wc_secret),
        wp_user=wp_user,
        wp_app_password=encrypt_secret(wp_app_password) if wp_app_password else None,
        is_active=is_active,
    )


def list_tenants(db: Session) -> list[dict]:
    tenants = tenant_repository.list_tenants(db)
    return [_serialize_tenant(tenant) for tenant in tenants]


def create_tenant(db: Session, payload: TenantCreate) -> dict:
    if tenant_repository.get_tenant_by_name(db, payload.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tenant name already exists")

    tenant = create_tenant_internal(
        db,
        name=payload.name,
        wc_url=payload.wc_url,
        wc_key=payload.wc_key,
        wc_secret=payload.wc_secret,
        wp_user=payload.wp_user,
        wp_app_password=payload.wp_app_password,
        is_active=payload.is_active,
    )
    db.commit()
    return _serialize_tenant(tenant)


def get_tenant(db: Session, tenant_id) -> dict:
    tenant = tenant_repository.get_tenant_by_id(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return _serialize_tenant(tenant)


def update_tenant(db: Session, tenant_id, payload: TenantUpdate) -> dict:
    tenant = tenant_repository.get_tenant_by_id(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    if payload.name is not None and payload.name != tenant.name:
        existing = tenant_repository.get_tenant_by_name(db, payload.name)
        if existing and existing.id != tenant.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tenant name already exists")

    if payload.name is not None:
        tenant.name = payload.name
    if payload.wc_url is not None:
        tenant.wc_url = payload.wc_url
    if payload.wc_key is not None:
        tenant.wc_key = encrypt_secret(payload.wc_key)
    if payload.wc_secret is not None:
        tenant.wc_secret = encrypt_secret(payload.wc_secret)
    if payload.wp_user is not None:
        tenant.wp_user = payload.wp_user
    if payload.wp_app_password is not None:
        tenant.wp_app_password = encrypt_secret(payload.wp_app_password) if payload.wp_app_password else None
    if payload.is_active is not None:
        tenant.is_active = payload.is_active

    tenant_repository.update_tenant(db, tenant)
    db.commit()
    return _serialize_tenant(tenant)


def get_decrypted_credentials(tenant) -> dict[str, str]:
    return {
        "wc_url": tenant.wc_url,
        "wc_key": decrypt_secret(tenant.wc_key),
        "wc_secret": decrypt_secret(tenant.wc_secret),
    }


def get_decrypted_wp_credentials(tenant) -> dict[str, str]:
    if not tenant.wp_user or not tenant.wp_app_password:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este cliente no tiene configuradas las credenciales de WordPress para la galería de imágenes",
        )
    return {
        "wp_user": tenant.wp_user,
        "wp_app_password": decrypt_secret(tenant.wp_app_password),
    }
