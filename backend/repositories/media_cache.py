from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from models.media_cache import MediaCacheRecord


def get_media_cache_record(db: Session, tenant_id: UUID, cache_key: str) -> MediaCacheRecord | None:
    stmt = select(MediaCacheRecord).where(
        MediaCacheRecord.tenant_id == tenant_id,
        MediaCacheRecord.cache_key == cache_key,
    )
    return db.execute(stmt).scalar_one_or_none()


def upsert_media_cache_record(
    db: Session,
    *,
    tenant_id: UUID,
    cache_key: str,
    page: int,
    total_pages: int,
    total: int,
    payload: list[dict],
) -> MediaCacheRecord:
    record = get_media_cache_record(db, tenant_id, cache_key)
    if record is None:
        record = MediaCacheRecord(
            tenant_id=tenant_id,
            cache_key=cache_key,
            page=page,
            total_pages=total_pages,
            total=total,
            payload=payload,
            created_at=datetime.utcnow(),
        )
    else:
        record.page = page
        record.total_pages = total_pages
        record.total = total
        record.payload = payload
        record.created_at = datetime.utcnow()

    db.add(record)
    db.flush()
    db.refresh(record)
    return record


def delete_media_cache_for_tenant(db: Session, tenant_id: UUID) -> None:
    db.execute(delete(MediaCacheRecord).where(MediaCacheRecord.tenant_id == tenant_id))
    db.flush()
