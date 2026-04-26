from io import BytesIO
from typing import Any

from fastapi import HTTPException, status
from openpyxl import load_workbook

from schemas.product import PreviewRow, UpdateSummary


ALLOWED_FIELDS = {
    "name",
    "slug",
    "sku",
    "type",
    "status",
    "featured",
    "catalog_visibility",
    "regular_price",
    "sale_price",
    "date_on_sale_from",
    "date_on_sale_to",
    "description",
    "short_description",
    "manage_stock",
    "stock_quantity",
    "stock_status",
    "backorders",
    "sold_individually",
    "low_stock_amount",
    "weight",
    "shipping_class",
    "virtual",
    "downloadable",
    "download_limit",
    "download_expiry",
}

HEADER_ALIASES = {
    "ID del producto": "product_id",
    "SKU": "sku",
    "Nombre": "name",
    "Slug": "slug",
    "Tipo": "type",
    "Estado": "status",
    "Destacado": "featured",
    "Visibilidad catalogo": "catalog_visibility",
    "Precio regular": "regular_price",
    "Precio oferta": "sale_price",
    "Oferta desde": "date_on_sale_from",
    "Oferta hasta": "date_on_sale_to",
    "Descripcion completa": "description",
    "Descripcion corta": "short_description",
    "Gestionar stock": "manage_stock",
    "Cantidad stock": "stock_quantity",
    "Estado stock": "stock_status",
    "Backorders": "backorders",
    "Venta individual": "sold_individually",
    "Alerta stock bajo": "low_stock_amount",
    "Peso": "weight",
    "Largo": "length",
    "Ancho": "width",
    "Alto": "height",
    "Clase de envio": "shipping_class",
    "Virtual": "virtual",
    "Descargable": "downloadable",
    "ID imagen principal": "image_principal_id",
    "IDs galeria": "image_galeria_ids",
    "Nombres imagenes": "image_nombres",
    "Atributo 1 nombre": "attr1_nombre",
    "Atributo 1 valores": "attr1_valores",
    "Atributo 2 nombre": "attr2_nombre",
    "Atributo 2 valores": "attr2_valores",
    "IDs categorias": "category_ids",
    "IDs etiquetas": "tag_ids",
    "IDs upsells": "upsell_ids",
    "IDs cross-sells": "cross_sell_ids",
    "Meta key": "meta_key",
    "Meta value": "meta_value",
}
TEMPLATE_SAMPLE_MARKERS = {
    "product_id": "12345",
    "sku": "03330154",
    "name": "Producto ejemplo",
}


def _normalize_header(header: object) -> str:
    value = "" if header is None else str(header).strip()
    if value.startswith("* "):
        value = value[2:].strip()
    return HEADER_ALIASES.get(value, value)


def parse_excel(file_bytes: bytes) -> tuple[list[str], list[dict[str, str]]]:
    workbook = load_workbook(filename=BytesIO(file_bytes), data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return [], []

    header_row_index = 2 if len(rows) >= 3 and any(str(value).strip() for value in rows[2] if value is not None) else 0
    headers = [_normalize_header(value) for value in rows[header_row_index]]
    parsed_rows: list[dict[str, str]] = []

    for row in rows[header_row_index + 1 :]:
        parsed_row: dict[str, str] = {}
        for index, header in enumerate(headers):
            if not header:
                continue
            value = row[index] if index < len(row) else None
            parsed_row[header] = "" if value is None else str(value)
        if all(parsed_row.get(key, "") == value for key, value in TEMPLATE_SAMPLE_MARKERS.items()):
            continue
        if any(value != "" for value in parsed_row.values()):
            parsed_rows.append(parsed_row)

    return headers, parsed_rows


def validate_mapping(headers: list[str], id_column: str, value_column: str, wc_field: str) -> None:
    if wc_field not in ALLOWED_FIELDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid WooCommerce field")
    if id_column not in headers or value_column not in headers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected columns were not found in the file")


def normalize_field_value(field: str, value: str):
    if field in {"stock_quantity", "low_stock_amount", "download_limit", "download_expiry"}:
        return int(float(value)) if value != "" else 0
    if field in {"regular_price", "sale_price"}:
        return str(value)
    if field == "status":
        return "draft" if str(value).strip().lower() in {"draft", "borrador", "inactive"} else "publish"
    if field in {"featured", "manage_stock", "sold_individually", "virtual", "downloadable"}:
        return str(value).strip().lower() in {"1", "true", "yes", "si", "sí", "y"}
    return value


async def generate_preview(
    *,
    rows: list[dict[str, str]],
    id_column: str,
    value_column: str,
    id_type: str,
    wc_field: str,
    products: list[dict[str, Any]],
) -> dict[str, Any]:
    identifiers = [row.get(id_column, "").strip() for row in rows if row.get(id_column)]

    if id_type == "product_id":
        products_by_id = {int(product["id"]): product for product in products}

        def matcher(identifier: str):
            return products_by_id.get(int(identifier)) if identifier.isdigit() else None
    else:
        products_by_sku = {str(product.get("sku", "")): product for product in products if product.get("sku")}

        def matcher(identifier: str):
            return products_by_sku.get(identifier)

    preview_rows: list[dict[str, Any]] = []
    for row in rows:
        identifier = row.get(id_column, "").strip()
        if not identifier:
            continue
        product = matcher(identifier)
        preview_row = PreviewRow(
            identifier=identifier,
            current_value=None if not product else product.get(wc_field),
            new_value=row.get(value_column, ""),
            product_found=product is not None,
            product_id=None if not product else product.get("id"),
            product_name=None if not product else product.get("name"),
        )
        preview_rows.append(preview_row.model_dump())

    return {
        "preview_rows": preview_rows,
        "sample_rows": rows[:5],
        "total_rows": len(rows),
    }


async def build_update_summary(
    *,
    rows: list[dict[str, str]],
    id_column: str,
    value_column: str,
    id_type: str,
    wc_field: str,
    products: list[dict[str, Any]],
    woo_service,
) -> tuple[UpdateSummary, list[dict[str, Any]]]:
    identifiers = [row.get(id_column, "").strip() for row in rows if row.get(id_column)]

    if id_type == "product_id":
        products_by_id = {int(product["id"]): product for product in products}

        def matcher(identifier: str):
            return products_by_id.get(int(identifier)) if identifier.isdigit() else None
    else:
        products_by_sku = {str(product.get("sku", "")): product for product in products if product.get("sku")}

        def matcher(identifier: str):
            return products_by_sku.get(identifier)

    update_payloads: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for row in rows:
        identifier = row.get(id_column, "").strip()
        if not identifier:
            continue
        product = matcher(identifier)
        if not product:
            errors.append({"identifier": identifier, "error": "Product not found"})
            continue
        try:
            update_payloads.append({"id": product["id"], wc_field: normalize_field_value(wc_field, row.get(value_column, ""))})
        except Exception as exc:
            errors.append({"identifier": identifier, "error": f"Invalid value: {exc}"})

    updated = 0
    updated_products: list[dict[str, Any]] = []
    for start in range(0, len(update_payloads), 100):
        batch = update_payloads[start : start + 100]
        try:
            result = await woo_service.batch_update(batch)
            batch_updates = result.get("update", [])
            updated += len(batch_updates)
            updated_products.extend(batch_updates)
            for failed in result.get("not_updated", []):
                errors.append(
                    {
                        "identifier": str(failed.get("id", "unknown")),
                        "error": failed.get("error", {}).get("message", "Update failed"),
                    }
                )
        except Exception as exc:
            for item in batch:
                errors.append({"identifier": str(item["id"]), "error": str(exc)})

    return UpdateSummary(updated=updated, failed=len(errors), errors=errors, total_rows=len(rows)), updated_products
