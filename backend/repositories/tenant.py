from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.tenant import Tenant


def list_tenants(db: Session) -> list[Tenant]:
    stmt = select(Tenant).order_by(Tenant.created_at.asc())
    return list(db.execute(stmt).scalars().all())


def get_tenant_by_id(db: Session, tenant_id: UUID) -> Tenant | None:
    stmt = select(Tenant).where(Tenant.id == tenant_id)
    return db.execute(stmt).scalar_one_or_none()


def get_tenant_by_name(db: Session, name: str) -> Tenant | None:
    stmt = select(Tenant).where(Tenant.name == name)
    return db.execute(stmt).scalar_one_or_none()


def create_tenant(
    db: Session,
    *,
    name: str,
    wc_url: str,
    wc_key: str,
    wc_secret: str,
    wp_user: str | None = None,
    wp_app_password: str | None = None,
    is_active: bool = True,
) -> Tenant:
    tenant = Tenant(
        name=name,
        wc_url=wc_url,
        wc_key=wc_key,
        wc_secret=wc_secret,
        wp_user=wp_user,
        wp_app_password=wp_app_password,
        is_active=is_active,
    )
    db.add(tenant)
    db.flush()
    db.refresh(tenant)
    return tenant


def update_tenant(db: Session, tenant: Tenant) -> Tenant:
    db.add(tenant)
    db.flush()
    db.refresh(tenant)
    return tenant
