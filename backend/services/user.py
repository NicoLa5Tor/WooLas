from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.security import hash_password
from models.user import Role
from repositories import tenant as tenant_repository
from repositories import user as user_repository
from schemas.user import AdminClientCreate, AdminClientRead, AdminClientUpdate, UserCreate, UserRead, UserTenantMembershipRead, UserUpdate
from services import tenant as tenant_service


def _serialize_user_with_membership(user, membership) -> dict:
    return UserRead(
        id=user.id,
        email=user.email,
        username=user.username,
        role=membership.role,
        is_superadmin=user.is_superadmin,
        is_active=user.is_active,
        created_at=user.created_at,
        last_login=user.last_login,
        memberships=[
            UserTenantMembershipRead(
                tenant_id=membership.tenant_id,
                tenant_name=membership.tenant.name if membership.tenant else "",
                role=membership.role,
            )
        ],
    ).model_dump(mode="json")


def list_users_for_tenant(db: Session, tenant_id) -> list[dict]:
    if not tenant_repository.get_tenant_by_id(db, tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    items = user_repository.list_users_for_tenant(db, tenant_id)
    return [_serialize_user_with_membership(user, membership) for user, membership in items]


def list_legacy_users_for_tenant(db: Session, tenant_id) -> list[dict]:
    return list_users_for_tenant(db, tenant_id)


def create_user_for_tenant(db: Session, tenant_id, payload: UserCreate) -> dict:
    if payload.role == Role.SUPERADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant users cannot be superadmin")

    tenant = tenant_repository.get_tenant_by_id(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    existing = user_repository.get_user_by_username(db, payload.username)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    user = user_repository.create_user(
        db,
        email=payload.email,
        username=payload.username,
        hashed_password=hash_password(payload.password),
        is_superadmin=False,
        is_active=True,
    )
    membership = user_repository.create_user_tenant_membership(db, user.id, tenant.id, payload.role)
    db.commit()
    return _serialize_user_with_membership(user, membership)


def update_user_for_tenant(db: Session, tenant_id, user_id, payload: UserUpdate, actor) -> dict:
    tenant_user = user_repository.get_user_in_tenant(db, tenant_id, user_id)
    if not tenant_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in tenant")

    user, membership = tenant_user
    if actor.id == user.id and payload.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account")

    if payload.password:
        user.hashed_password = hash_password(payload.password)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.role is not None:
        if payload.role == Role.SUPERADMIN:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant users cannot be superadmin")
        membership.role = payload.role
        user_repository.update_user_tenant_membership(db, membership)

    user_repository.update_user(db, user)
    db.commit()
    return _serialize_user_with_membership(user, membership)


def _serialize_admin_client(user, membership, tenant) -> dict:
    return AdminClientRead(
        id=user.id,
        email=user.email,
        username=user.username,
        role=membership.role,
        is_active=user.is_active,
        created_at=user.created_at,
        last_login=user.last_login,
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        wc_url=tenant.wc_url,
        wp_user=tenant.wp_user,
        has_wp_media_credentials=bool(tenant.wp_user and tenant.wp_app_password),
    ).model_dump(mode="json")


def list_admin_clients(db: Session) -> list[dict]:
    items = user_repository.list_client_accounts(db)
    return [_serialize_admin_client(user, membership, tenant) for user, membership, tenant in items]


def create_admin_client(db: Session, payload: AdminClientCreate) -> dict:
    if user_repository.get_user_by_username(db, payload.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    existing_email = user_repository.get_user_by_email(db, payload.email)
    if existing_email:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
    if tenant_repository.get_tenant_by_name(db, payload.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Store name already exists")

    tenant = tenant_service.create_tenant_internal(
        db,
        name=payload.name,
        wc_url=payload.wc_url,
        wc_key=payload.wc_key,
        wc_secret=payload.wc_secret,
        wp_user=payload.wp_user,
        wp_app_password=payload.wp_app_password,
        is_active=payload.is_active,
    )
    user = user_repository.create_user(
        db,
        email=payload.email,
        username=payload.username,
        hashed_password=hash_password(payload.password),
        is_superadmin=False,
        is_active=payload.is_active,
    )
    membership = user_repository.create_user_tenant_membership(db, user.id, tenant.id, Role.CLIENT)
    db.commit()
    return _serialize_admin_client(user, membership, tenant)


def delete_admin_client(db: Session, user_id, actor) -> None:
    account = user_repository.get_client_account(db, user_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    user, _, tenant = account
    if actor.id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes eliminarte a ti mismo")
    # Delete tenant first — DB CASCADE removes backups, media, import drafts, memberships
    user_repository.delete_tenant(db, tenant)
    # Delete user (memberships already gone via cascade)
    user_repository.delete_user(db, user)
    db.commit()


def update_admin_client(db: Session, user_id, payload: AdminClientUpdate) -> dict:
    account = user_repository.get_client_account(db, user_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    user, membership, tenant = account

    if payload.username is not None and payload.username != user.username:
        existing = user_repository.get_user_by_username(db, payload.username)
        if existing and existing.id != user.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
        user.username = payload.username

    if payload.email is not None and payload.email != user.email:
        existing = user_repository.get_user_by_email(db, payload.email)
        if existing and existing.id != user.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
        user.email = payload.email

    if payload.password:
        user.hashed_password = hash_password(payload.password)
    if payload.is_active is not None:
        user.is_active = payload.is_active
        tenant.is_active = payload.is_active

    if payload.tenant_name is not None and payload.tenant_name != tenant.name:
        existing_tenant = tenant_repository.get_tenant_by_name(db, payload.tenant_name)
        if existing_tenant and existing_tenant.id != tenant.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Store name already exists")
        tenant.name = payload.tenant_name

    if payload.wc_url is not None:
        tenant.wc_url = payload.wc_url
    if payload.wc_key is not None:
        tenant.wc_key = tenant_service.encrypt_secret(payload.wc_key)
    if payload.wc_secret is not None:
        tenant.wc_secret = tenant_service.encrypt_secret(payload.wc_secret)
    if payload.wp_user is not None:
        tenant.wp_user = payload.wp_user
    if payload.wp_app_password is not None:
        tenant.wp_app_password = tenant_service.encrypt_secret(payload.wp_app_password) if payload.wp_app_password else None

    user_repository.update_user(db, user)
    user_repository.update_user_tenant_membership(db, membership)
    tenant_repository.update_tenant(db, tenant)
    db.commit()
    return _serialize_admin_client(user, membership, tenant)
