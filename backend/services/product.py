from fastapi import HTTPException, status

from schemas.product import ProductCreate, ProductUpdate
from services import backup as backup_service
from services import excel as excel_service


async def preview_changes(*, file_bytes: bytes, id_column: str, value_column: str, id_type: str, wc_field: str, products: list[dict]):
    headers, rows = excel_service.parse_excel(file_bytes)
    excel_service.validate_mapping(headers, id_column, value_column, wc_field)
    preview = await excel_service.generate_preview(
        rows=rows,
        id_column=id_column,
        value_column=value_column,
        id_type=id_type,
        wc_field=wc_field,
        products=products,
    )
    return {"headers": headers, **preview}


async def update_from_excel(*, file_bytes: bytes, id_column: str, value_column: str, id_type: str, wc_field: str, products: list[dict], backup_record, db, woo_service):
    headers, rows = excel_service.parse_excel(file_bytes)
    excel_service.validate_mapping(headers, id_column, value_column, wc_field)
    summary, updated_products = await excel_service.build_update_summary(
        rows=rows,
        id_column=id_column,
        value_column=value_column,
        id_type=id_type,
        wc_field=wc_field,
        products=products,
        woo_service=woo_service,
    )
    backup_service.merge_products_into_backup(db, backup_record, updated_products)
    db.commit()
    return summary.model_dump()


async def list_products(*, page: int, search: str | None, products: list[dict]):
    filtered = products
    if search:
        term = search.strip().lower()
        filtered = [
            product
            for product in products
            if term in str(product.get("name", "")).lower()
            or term in str(product.get("sku", "")).lower()
            or term in str(product.get("slug", "")).lower()
        ]

    page_size = 50
    total = len(filtered)
    total_pages = max(1, (total + page_size - 1) // page_size)
    start = (page - 1) * page_size
    items = filtered[start : start + page_size]
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


async def get_product(*, product_id: int, products: list[dict]):
    product = next((item for item in products if int(item["id"]) == product_id), None)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found in latest backup")
    return product


def _build_wc_payload(payload: ProductCreate | ProductUpdate):
    values = {key: value for key, value in payload.model_dump().items() if value is not None}

    if "categories" in values:
        values["categories"] = [{"id": category_id} for category_id in values["categories"]]
    if "images" in values:
        mapped_images: list[dict] = []
        for image in values["images"]:
            image_payload: dict = {}
            if image.get("id") is not None:
                image_payload["id"] = image["id"]
            elif image.get("src"):
                image_payload["src"] = image["src"]
            if image_payload:
                mapped_images.append(image_payload)
        values["images"] = mapped_images
    if "dimensions" in values and values["dimensions"] is not None:
        dimensions = values["dimensions"]
        values["dimensions"] = {
            "length": str(dimensions.get("length", "") or ""),
            "width": str(dimensions.get("width", "") or ""),
            "height": str(dimensions.get("height", "") or ""),
        }

    return values


async def create_product(*, payload: ProductCreate, backup_record, db, woo_service):
    create_payload = _build_wc_payload(payload)
    created_product = await woo_service.create_product(create_payload)
    backup_service.merge_products_into_backup(db, backup_record, [created_product])
    db.commit()
    return created_product


async def update_product(*, product_id: int, payload: ProductUpdate, backup_record, db, woo_service):
    update_payload = _build_wc_payload(payload)
    update_payload.pop("sku", None)
    if not update_payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No product fields were provided")
    updated_product = await woo_service.update_product(product_id, update_payload)
    backup_service.merge_products_into_backup(db, backup_record, [updated_product])
    db.commit()
    return updated_product
