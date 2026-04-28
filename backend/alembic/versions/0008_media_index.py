"""add media index table

Revision ID: 0008_media_index
Revises: 0007_import_drafts
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0008_media_index"
down_revision = "0007_import_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_index_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("media_id", sa.Integer(), nullable=False),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column("thumbnail", sa.String(length=1000), nullable=False),
        sa.Column("filename", sa.String(length=500), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("slug", sa.String(length=500), nullable=True),
        sa.Column("lookup_values", sa.JSON(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "media_id", name="uq_media_index_tenant_media"),
    )
    op.create_index(op.f("ix_media_index_records_tenant_id"), "media_index_records", ["tenant_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_media_index_records_tenant_id"), table_name="media_index_records")
    op.drop_table("media_index_records")
