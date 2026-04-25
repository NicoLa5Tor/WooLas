import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from core.database import Base
from models.user import Role


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    wc_url: Mapped[str] = mapped_column(String(500), nullable=False)
    wc_key: Mapped[str] = mapped_column(String(1000), nullable=False)
    wc_secret: Mapped[str] = mapped_column(String(1000), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    user_memberships = relationship("UserTenant", back_populates="tenant", cascade="all, delete-orphan")
    backups = relationship("BackupRecord", back_populates="tenant", cascade="all, delete-orphan")


class UserTenant(Base):
    __tablename__ = "user_tenants"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[Role] = mapped_column(
        SqlEnum(Role, native_enum=False, values_callable=lambda enum_cls: [item.value for item in enum_cls]),
        nullable=False,
    )

    user = relationship("User", back_populates="tenant_memberships")
    tenant = relationship("Tenant", back_populates="user_memberships")
