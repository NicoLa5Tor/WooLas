"""initial multitenant schema"""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial_multitenant"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "users" in existing_tables:
        legacy_user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "role" in legacy_user_columns and "is_superadmin" not in legacy_user_columns:
            if "backup_records" in existing_tables:
                op.drop_table("backup_records")
            if "user_tenants" in existing_tables:
                op.drop_table("user_tenants")
            if "tenants" in existing_tables:
                op.drop_table("tenants")
            op.drop_index("ix_users_username", table_name="users")
            op.drop_table("users")
            existing_tables = set(inspector.get_table_names())

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("username", sa.String(length=100), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("is_superadmin", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_login", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)

    op.create_table(
        "tenants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("wc_url", sa.String(length=500), nullable=False),
        sa.Column("wc_key", sa.String(length=1000), nullable=False),
        sa.Column("wc_secret", sa.String(length=1000), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "user_tenants",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.Enum("superadmin", "admin", "client", name="role", native_enum=False), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "tenant_id"),
    )

    op.create_table(
        "backup_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.String(length=1000), nullable=False),
        sa.Column("product_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_backup_records_tenant_id"), "backup_records", ["tenant_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_backup_records_tenant_id"), table_name="backup_records")
    op.drop_table("backup_records")
    op.drop_table("user_tenants")
    op.drop_table("tenants")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_table("users")
