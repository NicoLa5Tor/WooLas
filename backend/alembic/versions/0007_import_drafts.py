"""add import drafts table"""

from alembic import op
import sqlalchemy as sa


revision = "0007_import_drafts"
down_revision = "0006_backup_kind"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "import_drafts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=1000), nullable=False),
        sa.Column("headers", sa.JSON(), nullable=False),
        sa.Column("sample_rows", sa.JSON(), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id"),
    )
    op.create_index(op.f("ix_import_drafts_tenant_id"), "import_drafts", ["tenant_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_import_drafts_tenant_id"), table_name="import_drafts")
    op.drop_table("import_drafts")
