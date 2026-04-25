"""store backup payload in database"""

from alembic import op
import sqlalchemy as sa


revision = "0003_backup_payload_in_db"
down_revision = "0002_add_user_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("backup_records", sa.Column("payload", sa.JSON(), nullable=True))
    op.execute("UPDATE backup_records SET payload = '[]'")
    op.alter_column("backup_records", "payload", nullable=False)


def downgrade() -> None:
    op.drop_column("backup_records", "payload")
