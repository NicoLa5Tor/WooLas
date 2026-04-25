"""add media cache table"""

from alembic import op
import sqlalchemy as sa


revision = "0005_media_cache"
down_revision = "0004_tenant_wp_media"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_cache_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("cache_key", sa.String(length=255), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("total_pages", sa.Integer(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "cache_key", name="uq_media_cache_tenant_key"),
    )
    op.create_index(op.f("ix_media_cache_records_tenant_id"), "media_cache_records", ["tenant_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_media_cache_records_tenant_id"), table_name="media_cache_records")
    op.drop_table("media_cache_records")
