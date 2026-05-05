from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.orm import Session, joinedload

from models.tenant import Tenant, UserTenant  # noqa: F401 – Tenant used in delete_tenant
from models.user import Role, User


def get_user_by_id(db: Session, user_id: UUID) -> User | None:
    stmt: Select[tuple[User]] = (
        select(User)
        .options(joinedload(User.tenant_memberships).joinedload(UserTenant.tenant))
        .where(User.id == user_id)
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def get_user_by_username(db: Session, username: str) -> User | None:
    stmt: Select[tuple[User]] = (
        select(User)
        .options(joinedload(User.tenant_memberships).joinedload(UserTenant.tenant))
        .where(User.username == username)
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def count_superadmins(db: Session) -> int:
    stmt = select(User).where(User.is_superadmin.is_(True))
    return len(db.execute(stmt).scalars().all())


def get_first_superadmin(db: Session) -> User | None:
    stmt: Select[tuple[User]] = (
        select(User)
        .options(joinedload(User.tenant_memberships).joinedload(UserTenant.tenant))
        .where(User.is_superadmin.is_(True))
        .limit(1)
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def create_user(
    db: Session,
    *,
    email: str | None = None,
    username: str,
    hashed_password: str,
    is_superadmin: bool = False,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        username=username,
        hashed_password=hashed_password,
        is_superadmin=is_superadmin,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    db.refresh(user)
    return user


def update_user(db: Session, user: User) -> User:
    db.add(user)
    db.flush()
    db.refresh(user)
    return user


def list_users_for_tenant(db: Session, tenant_id: UUID) -> list[tuple[User, UserTenant]]:
    stmt = (
        select(User, UserTenant)
        .join(UserTenant, UserTenant.user_id == User.id)
        .where(UserTenant.tenant_id == tenant_id)
        .order_by(User.created_at.desc())
    )
    return list(db.execute(stmt).all())


def get_user_tenant_membership(db: Session, user_id: UUID, tenant_id: UUID) -> UserTenant | None:
    stmt = (
        select(UserTenant)
        .options(joinedload(UserTenant.user), joinedload(UserTenant.tenant))
        .where(UserTenant.user_id == user_id, UserTenant.tenant_id == tenant_id)
    )
    return db.execute(stmt).scalar_one_or_none()


def create_user_tenant_membership(db: Session, user_id: UUID, tenant_id: UUID, role: Role) -> UserTenant:
    membership = UserTenant(user_id=user_id, tenant_id=tenant_id, role=role)
    db.add(membership)
    db.flush()
    db.refresh(membership)
    return membership


def update_user_tenant_membership(db: Session, membership: UserTenant) -> UserTenant:
    db.add(membership)
    db.flush()
    db.refresh(membership)
    return membership


def get_user_in_tenant(db: Session, tenant_id: UUID, user_id: UUID) -> tuple[User, UserTenant] | None:
    stmt = (
        select(User, UserTenant)
        .join(UserTenant, UserTenant.user_id == User.id)
        .where(UserTenant.tenant_id == tenant_id, User.id == user_id)
    )
    return db.execute(stmt).first()


def list_tenants_for_user(db: Session, user_id: UUID) -> list[Tenant]:
    stmt = (
        select(Tenant)
        .join(UserTenant, UserTenant.tenant_id == Tenant.id)
        .where(UserTenant.user_id == user_id)
        .order_by(Tenant.created_at.asc())
    )
    return list(db.execute(stmt).scalars().all())


def get_user_by_email(db: Session, email: str) -> User | None:
    stmt: Select[tuple[User]] = (
        select(User)
        .options(joinedload(User.tenant_memberships).joinedload(UserTenant.tenant))
        .where(User.email == email)
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def list_client_accounts(db: Session) -> list[tuple[User, UserTenant, Tenant]]:
    stmt = (
        select(User, UserTenant, Tenant)
        .join(UserTenant, UserTenant.user_id == User.id)
        .join(Tenant, Tenant.id == UserTenant.tenant_id)
        .where(User.is_superadmin.is_(False), UserTenant.role == Role.CLIENT)
        .order_by(Tenant.created_at.desc())
    )
    return list(db.execute(stmt).all())


def get_client_account(db: Session, user_id: UUID) -> tuple[User, UserTenant, Tenant] | None:
    stmt = (
        select(User, UserTenant, Tenant)
        .join(UserTenant, UserTenant.user_id == User.id)
        .join(Tenant, Tenant.id == UserTenant.tenant_id)
        .where(User.id == user_id, User.is_superadmin.is_(False), UserTenant.role == Role.CLIENT)
    )
    return db.execute(stmt).first()


def delete_user(db: Session, user: User) -> None:
    db.delete(user)
    db.flush()


def delete_tenant(db: Session, tenant: Tenant) -> None:
    db.delete(tenant)
    db.flush()
