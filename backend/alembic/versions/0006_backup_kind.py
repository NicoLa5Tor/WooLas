"""add backup kind to backup records"""

from alembic import op
import sqlalchemy as sa


revision = "0006_backup_kind"
down_revision = "0005_media_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "backup_records",
        sa.Column("backup_kind", sa.String(length=32), nullable=True, server_default="manual"),
    )
    op.execute("UPDATE backup_records SET backup_kind = 'manual' WHERE backup_kind IS NULL")
    op.alter_column("backup_records", "backup_kind", nullable=False, server_default=None)


def downgrade() -> None:
    op.drop_column("backup_records", "backup_kind")
