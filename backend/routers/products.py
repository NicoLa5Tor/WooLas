from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response

from core.dependencies import TenantAccessContext, require_recent_backup
from core.responses import success_response
from models.user import Role
from schemas.product import ProductCreate, ProductUpdate, ProductVariationCreate, ProductVariationUpdate
from services import imports as import_service
from services import product as product_service
from services.woocommerce import WooCommerceService


router = APIRouter(prefix="/api/tenants/{tenant_id}/products", tags=["products"])
catalog_router = APIRouter(prefix="/api/tenants/{tenant_id}", tags=["products"])


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


@router.get("/export")
async def export_products_excel(context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    filename, file_bytes = import_service.build_products_export(context.backup_record.payload)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=file_bytes, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


@router.get("/categories")
async def list_categories(context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await product_service.list_categories(woo_service=woo_service))


@router.get("/tags")
async def list_tags(context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await product_service.list_tags(woo_service=woo_service))


@router.get("/attributes")
async def list_attributes(context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await product_service.list_attributes(woo_service=woo_service))


@router.get("/attributes/{attribute_id}/terms")
async def list_attribute_terms(attribute_id: int, context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await product_service.list_attribute_terms(attribute_id=attribute_id, woo_service=woo_service))


@catalog_router.get("/categories")
async def list_categories_alias(context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await product_service.list_categories(woo_service=woo_service))


@catalog_router.get("/tags")
async def list_tags_alias(context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await product_service.list_tags(woo_service=woo_service))


@catalog_router.get("/attributes")
async def list_attributes_alias(context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await product_service.list_attributes(woo_service=woo_service))


@catalog_router.get("/attributes/{attribute_id}/terms")
async def list_attribute_terms_alias(attribute_id: int, context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await product_service.list_attribute_terms(attribute_id=attribute_id, woo_service=woo_service))


@router.get("/{product_id}/variations")
async def list_variations(product_id: int, context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT))):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(await product_service.list_variations(product_id=product_id, woo_service=woo_service))


@router.post("/{product_id}/variations")
async def create_variation(
    product_id: int,
    payload: ProductVariationCreate,
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(
        await product_service.create_variation(
            product_id=product_id,
            payload=payload,
            backup_record=context.backup_record,
            db=context.db,
            woo_service=woo_service,
        )
    )


@router.put("/{product_id}/variations/{variation_id}")
async def update_variation(
    product_id: int,
    variation_id: int,
    payload: ProductVariationUpdate,
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(
        await product_service.update_variation(
            product_id=product_id,
            variation_id=variation_id,
            payload=payload,
            backup_record=context.backup_record,
            db=context.db,
            woo_service=woo_service,
        )
    )


@router.delete("/{product_id}/variations/{variation_id}")
async def delete_variation(
    product_id: int,
    variation_id: int,
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    woo_service = WooCommerceService(**context.credentials)
    return success_response(
        await product_service.delete_variation(
            product_id=product_id,
            variation_id=variation_id,
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
