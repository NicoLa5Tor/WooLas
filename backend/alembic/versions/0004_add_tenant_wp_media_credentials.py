"""add tenant wordpress media credentials"""

from alembic import op
import sqlalchemy as sa


revision = "0004_tenant_wp_media"
down_revision = "0003_backup_payload_in_db"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("wp_user", sa.String(length=255), nullable=True))
    op.add_column("tenants", sa.Column("wp_app_password", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "wp_app_password")
    op.drop_column("tenants", "wp_user")
