from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from models.media_index import MediaIndexRecord


def list_media_index_records(db: Session, tenant_id: UUID) -> list[MediaIndexRecord]:
    stmt = select(MediaIndexRecord).where(MediaIndexRecord.tenant_id == tenant_id).order_by(MediaIndexRecord.media_id.asc())
    return list(db.execute(stmt).scalars().all())


def get_media_index_record(db: Session, tenant_id: UUID, media_id: int) -> MediaIndexRecord | None:
    stmt = select(MediaIndexRecord).where(MediaIndexRecord.tenant_id == tenant_id, MediaIndexRecord.media_id == media_id)
    return db.execute(stmt).scalar_one_or_none()


def upsert_media_index_record(
    db: Session,
    *,
    tenant_id: UUID,
    media_id: int,
    url: str,
    thumbnail: str,
    filename: str,
    title: str | None,
    slug: str | None,
    lookup_values: list[str],
    uploaded_at,
) -> MediaIndexRecord:
    record = get_media_index_record(db, tenant_id, media_id)
    if record is None:
        record = MediaIndexRecord(
            tenant_id=tenant_id,
            media_id=media_id,
            url=url,
            thumbnail=thumbnail,
            filename=filename,
            title=title,
            slug=slug,
            lookup_values=lookup_values,
            uploaded_at=uploaded_at,
            updated_at=datetime.utcnow(),
        )
    else:
        record.url = url
        record.thumbnail = thumbnail
        record.filename = filename
        record.title = title
        record.slug = slug
        record.lookup_values = lookup_values
        record.uploaded_at = uploaded_at
        record.updated_at = datetime.utcnow()

    db.add(record)
    db.flush()
    db.refresh(record)
    return record


def delete_missing_media_index_records(db: Session, tenant_id: UUID, keep_media_ids: set[int]) -> None:
    stmt = delete(MediaIndexRecord).where(MediaIndexRecord.tenant_id == tenant_id)
    if keep_media_ids:
        stmt = stmt.where(MediaIndexRecord.media_id.not_in(tuple(keep_media_ids)))
    db.execute(stmt)
    db.flush()
