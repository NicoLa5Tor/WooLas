from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.security import decrypt_secret, encrypt_secret
from repositories import tenant as tenant_repository
from schemas.tenant import TenantCreate, TenantRead, TenantUpdate


def create_tenant_internal(
    db: Session,
    *,
    name: str,
    wc_url: str,
    wc_key: str,
    wc_secret: str,
    is_active: bool,
):
    return tenant_repository.create_tenant(
        db,
        name=name,
        wc_url=wc_url,
        wc_key=encrypt_secret(wc_key),
        wc_secret=encrypt_secret(wc_secret),
        is_active=is_active,
    )


def list_tenants(db: Session) -> list[dict]:
    tenants = tenant_repository.list_tenants(db)
    return [TenantRead.model_validate(tenant).model_dump(mode="json") for tenant in tenants]


def create_tenant(db: Session, payload: TenantCreate) -> dict:
    if tenant_repository.get_tenant_by_name(db, payload.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tenant name already exists")

    tenant = create_tenant_internal(
        db,
        name=payload.name,
        wc_url=payload.wc_url,
        wc_key=payload.wc_key,
        wc_secret=payload.wc_secret,
        is_active=payload.is_active,
    )
    db.commit()
    return TenantRead.model_validate(tenant).model_dump(mode="json")


def get_tenant(db: Session, tenant_id) -> dict:
    tenant = tenant_repository.get_tenant_by_id(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return TenantRead.model_validate(tenant).model_dump(mode="json")


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
    if payload.is_active is not None:
        tenant.is_active = payload.is_active

    tenant_repository.update_tenant(db, tenant)
    db.commit()
    return TenantRead.model_validate(tenant).model_dump(mode="json")


def get_decrypted_credentials(tenant) -> dict[str, str]:
    return {
        "wc_url": tenant.wc_url,
        "wc_key": decrypt_secret(tenant.wc_key),
        "wc_secret": decrypt_secret(tenant.wc_secret),
    }
