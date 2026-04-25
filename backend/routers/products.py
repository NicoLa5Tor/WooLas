from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile

from core.dependencies import TenantAccessContext, require_recent_backup
from core.responses import success_response
from models.user import Role
from schemas.product import ProductCreate, ProductUpdate
from services import product as product_service
from services.woocommerce import WooCommerceService


router = APIRouter(prefix="/api/tenants/{tenant_id}/products", tags=["products"])


@router.get("")
async def list_products(
    page: int = 1,
    search: str | None = None,
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    return success_response(await product_service.list_products(page=page, search=search, products=context.backup_record.payload))


@router.post("")
async def create_product(
    payload: ProductCreate,
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(
        await product_service.create_product(
            payload=payload,
            backup_record=context.backup_record,
            db=context.db,
            woo_service=woo_service,
        )
    )


@router.get("/{product_id}")
async def get_product(product_id: int, context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    return success_response(await product_service.get_product(product_id=product_id, products=context.backup_record.payload))


@router.put("/{product_id}")
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(
        await product_service.update_product(
            product_id=product_id,
            payload=payload,
            backup_record=context.backup_record,
            db=context.db,
            woo_service=woo_service,
        )
    )


@router.post("/preview")
async def preview_product_changes(
    file: UploadFile = File(...),
    id_column: str = Form(...),
    value_column: str = Form(...),
    id_type: str = Form(...),
    wc_field: str = Form(...),
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    file_bytes = await file.read()
    data = await product_service.preview_changes(
        file_bytes=file_bytes,
        id_column=id_column,
        value_column=value_column,
        id_type=id_type,
        wc_field=wc_field,
        products=context.backup_record.payload,
    )
    return success_response(data)


@router.post("/update")
async def update_products_from_excel(
    file: UploadFile = File(...),
    id_column: str = Form(...),
    value_column: str = Form(...),
    id_type: str = Form(...),
    wc_field: str = Form(...),
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    woo_service = WooCommerceService(**context.credentials)
    file_bytes = await file.read()
    data = await product_service.update_from_excel(
        file_bytes=file_bytes,
        id_column=id_column,
        value_column=value_column,
        id_type=id_type,
        wc_field=wc_field,
        products=context.backup_record.payload,
        backup_record=context.backup_record,
        db=context.db,
        woo_service=woo_service,
    )
    return success_response(data)
