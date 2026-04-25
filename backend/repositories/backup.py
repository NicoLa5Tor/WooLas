from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.backup import BackupRecord


def _with_backup_kind_filter(stmt, backup_kinds: Sequence[str] | None):
    if backup_kinds:
        stmt = stmt.where(BackupRecord.backup_kind.in_(tuple(backup_kinds)))
    return stmt


def create_backup_record(
    db: Session,
    *,
    tenant_id: UUID,
    filename: str,
    file_path: str,
    backup_kind: str,
    payload: list[dict],
    product_count: int,
) -> BackupRecord:
    record = BackupRecord(
        tenant_id=tenant_id,
        filename=filename,
        file_path=file_path,
        backup_kind=backup_kind,
        payload=payload,
        product_count=product_count,
    )
    db.add(record)
    db.flush()
    db.refresh(record)
    return record


def list_backups_for_tenant(db: Session, tenant_id: UUID, backup_kinds: Sequence[str] | None = None) -> list[BackupRecord]:
    stmt = select(BackupRecord).where(BackupRecord.tenant_id == tenant_id)
    stmt = _with_backup_kind_filter(stmt, backup_kinds).order_by(BackupRecord.created_at.desc())
    return list(db.execute(stmt).scalars().all())


def list_oldest_backups_for_tenant(db: Session, tenant_id: UUID, backup_kinds: Sequence[str] | None = None) -> list[BackupRecord]:
    stmt = select(BackupRecord).where(BackupRecord.tenant_id == tenant_id)
    stmt = _with_backup_kind_filter(stmt, backup_kinds).order_by(BackupRecord.created_at.asc())
    return list(db.execute(stmt).scalars().all())


def get_backup_for_tenant(db: Session, tenant_id: UUID, backup_id: UUID) -> BackupRecord | None:
    stmt = select(BackupRecord).where(
        BackupRecord.tenant_id == tenant_id,
        BackupRecord.id == backup_id,
    )
    return db.execute(stmt).scalar_one_or_none()


def get_backup_by_filename_for_tenant(db: Session, tenant_id: UUID, filename: str) -> BackupRecord | None:
    stmt = select(BackupRecord).where(
        BackupRecord.tenant_id == tenant_id,
        BackupRecord.filename == filename,
    )
    return db.execute(stmt).scalar_one_or_none()


def delete_backup_record(db: Session, record: BackupRecord) -> None:
    db.delete(record)
    db.flush()


def get_latest_backup_for_tenant(db: Session, tenant_id: UUID, backup_kinds: Sequence[str] | None = None) -> BackupRecord | None:
    stmt = select(BackupRecord).where(BackupRecord.tenant_id == tenant_id)
    stmt = _with_backup_kind_filter(stmt, backup_kinds).order_by(BackupRecord.created_at.desc()).limit(1)
    return db.execute(stmt).scalar_one_or_none()


def update_backup_record(db: Session, record: BackupRecord) -> BackupRecord:
    db.add(record)
    db.flush()
    db.refresh(record)
    return record
