import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from core.database import Base


class MediaCacheRecord(Base):
    __tablename__ = "media_cache_records"
    __table_args__ = (UniqueConstraint("tenant_id", "cache_key", name="uq_media_cache_tenant_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    cache_key: Mapped[str] = mapped_column(String(255), nullable=False)
    page: Mapped[int] = mapped_column(Integer, nullable=False)
    total_pages: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    payload: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
