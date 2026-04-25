import json
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.config import settings
from repositories import backup as backup_repository

MAX_BACKUPS_PER_TENANT = 3
MAX_BACKUP_AGE_HOURS = 2


def _enforce_backup_limit(db: Session, tenant_id) -> None:
    backups = backup_repository.list_oldest_backups_for_tenant(db, tenant_id)
    overflow = len(backups) - MAX_BACKUPS_PER_TENANT
    if overflow <= 0:
        return

    for record in backups[:overflow]:
        backup_repository.delete_backup_record(db, record)


async def create_backup(db: Session, tenant, woo_service) -> dict:
    products = await woo_service.fetch_all_products()
    filename = f"backup_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"

    record = backup_repository.create_backup_record(
        db,
        tenant_id=tenant.id,
        filename=filename,
        file_path="db://backup_records",
        payload=products,
        product_count=len(products),
    )
    _enforce_backup_limit(db, tenant.id)
    db.commit()
    return {
        "id": str(record.id),
        "filename": record.filename,
        "product_count": record.product_count,
        "created_at": record.created_at.isoformat(),
    }


def list_backups(db: Session, tenant_id) -> list[dict]:
    backups = backup_repository.list_backups_for_tenant(db, tenant_id)
    return [
        {
            "id": str(backup.id),
            "filename": backup.filename,
            "product_count": backup.product_count,
            "created_at": backup.created_at.isoformat(),
        }
        for backup in backups
    ]


def get_backup_file(db: Session, tenant_id, backup_id) -> tuple[Path, str]:
    record = backup_repository.get_backup_for_tenant(db, tenant_id, backup_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    payload = json.dumps(record.payload, ensure_ascii=False, indent=2)
    return Path(record.filename), payload


def get_backup_file_by_filename(db: Session, tenant_id, filename: str) -> tuple[Path, str]:
    record = backup_repository.get_backup_by_filename_for_tenant(db, tenant_id, filename)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    return get_backup_file(db, tenant_id, record.id)


def get_latest_backup_or_raise(db: Session, tenant_id):
    record = backup_repository.get_latest_backup_for_tenant(db, tenant_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Debes crear un backup antes de continuar")
    return record


def require_fresh_backup(db: Session, tenant_id):
    record = get_latest_backup_or_raise(db, tenant_id)
    if record.created_at + timedelta(hours=MAX_BACKUP_AGE_HOURS) < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El backup actual tiene más de 2 horas. Debes crear un nuevo backup antes de continuar",
        )
    return record


def merge_products_into_backup(db: Session, backup_record, updated_products: list[dict]) -> None:
    if not updated_products:
        return

    product_map = {int(product["id"]): product for product in backup_record.payload}
    for product in updated_products:
        product_map[int(product["id"])] = product

    backup_record.payload = list(product_map.values())
    backup_record.product_count = len(backup_record.payload)
    backup_record.created_at = datetime.utcnow()
    backup_repository.update_backup_record(db, backup_record)
