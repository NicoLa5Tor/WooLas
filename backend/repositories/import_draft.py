from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from models.import_draft import ImportDraft


def get_import_draft_for_tenant(db: Session, tenant_id: UUID) -> ImportDraft | None:
    stmt = select(ImportDraft).where(ImportDraft.tenant_id == tenant_id)
    return db.execute(stmt).scalar_one_or_none()


def get_import_draft_by_id(db: Session, tenant_id: UUID, draft_id: UUID) -> ImportDraft | None:
    stmt = select(ImportDraft).where(
        ImportDraft.tenant_id == tenant_id,
        ImportDraft.id == draft_id,
    )
    return db.execute(stmt).scalar_one_or_none()


def upsert_import_draft(
    db: Session,
    *,
    tenant_id: UUID,
    created_by_user_id: UUID | None,
    original_filename: str,
    storage_path: str,
    headers: list[str],
    sample_rows: list[dict],
    row_count: int,
) -> ImportDraft:
    existing = get_import_draft_for_tenant(db, tenant_id)
    if existing is not None:
        db.delete(existing)
        db.flush()

    record = ImportDraft(
        tenant_id=tenant_id,
        created_by_user_id=created_by_user_id,
        original_filename=original_filename,
        storage_path=storage_path,
        headers=headers,
        sample_rows=sample_rows,
        row_count=row_count,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(record)
    db.flush()
    db.refresh(record)
    return record


def delete_import_draft(db: Session, draft: ImportDraft) -> None:
    db.delete(draft)
    db.flush()


def delete_import_draft_for_tenant(db: Session, tenant_id: UUID) -> None:
    db.execute(delete(ImportDraft).where(ImportDraft.tenant_id == tenant_id))
    db.flush()
