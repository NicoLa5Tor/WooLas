import asyncio
import re
from pathlib import PurePosixPath
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException, status

from schemas.product import (
    AssignImagesBySkuResult,
    AssignImagesBySkuStatus,
    ProductCreate,
    ProductUpdate,
    ProductVariationCreate,
    ProductVariationUpdate,
)
from services import backup as backup_service
from services import excel as excel_service

SKU_FILENAME_RE = re.compile(r"^(?P<sku>[^-]+)-")
IMAGE_PRIMARY_RE = re.compile(r"-1(?:\.[A-Za-z0-9]+)?$", re.IGNORECASE)
assign_images_jobs: dict[str, AssignImagesBySkuStatus] = {}


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


async def list_products(*, page: int, search: str | None, products: list[dict], type_filter: str | None = None):
    filtered = products
    if type_filter:
        filtered = [p for p in filtered if str(p.get("type") or "") == type_filter]
    if search:
        term = search.strip().lower()
        filtered = [
            product
            for product in filtered
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


async def get_product(*, product_id: int, products: list[dict], woo_service=None, backup_record=None, db=None):
    # Fetch live de WooCommerce para evitar editar snapshot stale (stock vendido, meta de plugins).
    # Si WC falla, fallback al backup como red de seguridad.
    if woo_service is not None:
        try:
            live_product = await woo_service.get_product(product_id)
            if live_product and live_product.get("id"):
                if backup_record is not None and db is not None:
                    backup_service.merge_products_into_backup(db, backup_record, [live_product])
                    db.commit()
                return live_product
        except httpx.HTTPError:
            pass

    product = next((item for item in products if int(item["id"]) == product_id), None)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found in latest backup")
    return product


def _normalize_dimensions(dimensions: dict[str, Any] | None):
    if dimensions is None:
        return None
    return {
        "length": str(dimensions.get("length") or ""),
        "width": str(dimensions.get("width") or ""),
        "height": str(dimensions.get("height") or ""),
    }


def _normalize_image_list(images: list[dict[str, Any]]):
    mapped_images: list[dict[str, Any]] = []
    for image in images:
        if image.get("id") is not None:
            mapped_images.append({"id": int(image["id"])})
    return mapped_images


def _normalize_taxonomy_refs(values: list[dict[str, Any]]):
    return [{"id": int(item["id"])} for item in values if item.get("id") is not None]


def _normalize_attributes(attributes: list[dict[str, Any]]):
    normalized: list[dict[str, Any]] = []
    for attribute in attributes:
        item: dict[str, Any] = {
            "position": int(attribute.get("position") or 0),
            "visible": bool(attribute.get("visible", True)),
            "variation": bool(attribute.get("variation", False)),
            "options": [str(option) for option in attribute.get("options", []) if str(option).strip()],
        }
        if attribute.get("id") is not None:
            item["id"] = int(attribute["id"])
        if attribute.get("name"):
            item["name"] = str(attribute["name"])
        # Conservar slug: para productos variable, variations enlazan atributos por slug.
        if attribute.get("slug"):
            item["slug"] = str(attribute["slug"])
        normalized.append(item)
    return normalized


def _normalize_downloads(downloads: list[dict[str, Any]]):
    return [{"name": str(item.get("name") or ""), "file": str(item.get("file") or "")} for item in downloads if item.get("name") and item.get("file")]


def _normalize_meta_data(meta_data: list[dict[str, Any]]):
    return [{"key": str(item.get("key") or ""), "value": item.get("value")} for item in meta_data if str(item.get("key") or "").strip()]


def _build_wc_payload(payload: ProductCreate | ProductUpdate):
    # Frontend manda solo campos modificados (diff). Si campo viene presente lo respetamos
    # tal cual — array vacío significa "vaciar intencionalmente"; campo ausente = WC conserva.
    values = {key: value for key, value in payload.model_dump(exclude_unset=True).items()}

    if "images" in values:
        values["images"] = _normalize_image_list(values["images"])
    if "categories" in values:
        values["categories"] = _normalize_taxonomy_refs(values["categories"])
    if "tags" in values:
        values["tags"] = _normalize_taxonomy_refs(values["tags"])
    if "attributes" in values:
        values["attributes"] = _normalize_attributes(values["attributes"])
    if "dimensions" in values:
        values["dimensions"] = _normalize_dimensions(values["dimensions"])
    if "downloads" in values:
        values["downloads"] = _normalize_downloads(values["downloads"])
    if "meta_data" in values:
        # WC REST hace upsert por key; claves ausentes se conservan. Frontend ya filtra solo
        # entries editados, así que no tocamos meta de plugins no-modificada.
        values["meta_data"] = _normalize_meta_data(values["meta_data"])
    # grouped_products solo aplica a type=grouped; strip si tipo distinto está presente.
    if values.get("type") and values.get("type") != "grouped":
        values.pop("grouped_products", None)

    return values


def _build_variation_payload(payload: ProductVariationCreate | ProductVariationUpdate):
    values = {key: value for key, value in payload.model_dump(exclude_unset=True).items()}
    if "dimensions" in values:
        values["dimensions"] = _normalize_dimensions(values["dimensions"])
    if "image" in values and values["image"] is not None:
        image_id = values["image"].get("id")
        values["image"] = {"id": int(image_id)} if image_id is not None else None
    if "attributes" in values:
        attributes: list[dict[str, Any]] = []
        for attribute in values["attributes"]:
            option = str(attribute.get("option") or "").strip()
            if not option:
                continue
            item = {"option": option}
            if attribute.get("id") is not None:
                item["id"] = int(attribute["id"])
            attributes.append(item)
        values["attributes"] = attributes
    if "downloads" in values:
        values["downloads"] = _normalize_downloads(values["downloads"])
    if "meta_data" in values:
        values["meta_data"] = _normalize_meta_data(values["meta_data"])
    return values


async def create_product(*, payload: ProductCreate, backup_record, db, woo_service):
    created_product = await woo_service.create_product(_build_wc_payload(payload))
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


async def list_categories(*, woo_service):
    return await woo_service.list_categories()


async def list_tags(*, woo_service):
    return await woo_service.list_tags()


async def list_attributes(*, woo_service):
    return await woo_service.list_attributes()


async def list_attribute_terms(*, attribute_id: int, woo_service):
    return await woo_service.list_attribute_terms(attribute_id)


async def list_variations(*, product_id: int, woo_service):
    return await woo_service.list_variations(product_id)


async def create_variation(*, product_id: int, payload: ProductVariationCreate, backup_record, db, woo_service):
    created_variation = await woo_service.create_variation(product_id, _build_variation_payload(payload))
    parent_product = await woo_service.get_product(product_id)
    backup_service.merge_products_into_backup(db, backup_record, [parent_product])
    db.commit()
    return created_variation


async def update_variation(*, product_id: int, variation_id: int, payload: ProductVariationUpdate, backup_record, db, woo_service):
    update_payload = _build_variation_payload(payload)
    if not update_payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No variation fields were provided")
    updated_variation = await woo_service.update_variation(product_id, variation_id, update_payload)
    parent_product = await woo_service.get_product(product_id)
    backup_service.merge_products_into_backup(db, backup_record, [parent_product])
    db.commit()
    return updated_variation


async def delete_variation(*, product_id: int, variation_id: int, backup_record, db, woo_service):
    deleted = await woo_service.delete_variation(product_id, variation_id)
    parent_product = await woo_service.get_product(product_id)
    backup_service.merge_products_into_backup(db, backup_record, [parent_product])
    db.commit()
    return deleted


def _extract_media_filename(item: dict[str, Any]) -> str:
    source = item.get("source_url") or ""
    media_file = item.get("media_details", {}).get("file") or ""
    candidate = media_file or source
    return PurePosixPath(candidate).name


async def _fetch_all_wp_media(*, wp_url: str, wp_user: str, wp_app_password: str) -> list[dict[str, Any]]:
    from services.media import _base_wp_url

    items: list[dict[str, Any]] = []
    page = 1
    endpoint = f"{_base_wp_url(wp_url)}/wp-json/wp/v2/media"
    async with httpx.AsyncClient(timeout=60.0, auth=httpx.BasicAuth(wp_user, wp_app_password)) as client:
        while True:
            response = await client.get(endpoint, params={"media_type": "image", "per_page": 100, "page": page})
            response.raise_for_status()
            page_items = response.json()
            if not page_items:
                break
            items.extend(page_items)
            total_pages = int(response.headers.get("X-WP-TotalPages", page))
            if page >= total_pages:
                break
            page += 1
    return items


def _group_images_by_sku(media_items: list[dict[str, Any]]):
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in media_items:
        filename = _extract_media_filename(item)
        match = SKU_FILENAME_RE.match(filename)
        if not match:
            continue
        sku = match.group("sku").strip()
        if not sku:
            continue
        grouped.setdefault(sku, []).append(item)

    def sort_key(item: dict[str, Any]):
        filename = _extract_media_filename(item)
        return (0 if IMAGE_PRIMARY_RE.search(filename) else 1, filename.lower())

    for sku, items in grouped.items():
        items.sort(key=sort_key)
    return grouped


async def _run_assign_images_job(
    *,
    job_id: str,
    tenant_id: UUID,
    backup_id: UUID,
    woo_service,
    wp_url: str,
    wp_user: str,
    wp_app_password: str,
):
    from core.database import SessionLocal
    from repositories import backup as backup_repository

    job = assign_images_jobs[job_id]
    try:
        job.status = "running"
        media_items = await _fetch_all_wp_media(wp_url=wp_url, wp_user=wp_user, wp_app_password=wp_app_password)
        grouped = _group_images_by_sku(media_items)
        skus = list(grouped.keys())
        job.total = len(skus)
        result = AssignImagesBySkuResult()
        updated_products: list[dict[str, Any]] = []
        products_by_sku = await woo_service.get_products_by_skus(skus)

        for index, sku in enumerate(skus, start=1):
            product = products_by_sku.get(sku)
            if product is None:
                result.skus_not_found.append(sku)
            else:
                try:
                    images_payload = [{"id": int(item["id"])} for item in grouped[sku] if item.get("id") is not None]
                    updated_product = await woo_service.update_product(int(product["id"]), {"images": images_payload})
                    updated_products.append(updated_product)
                    result.products_updated += 1
                except Exception as exc:
                    result.errors.append({"sku": sku, "error": str(exc)})

            job.processed = index
            job.progress = int(index * 100 / max(len(skus), 1))

        if updated_products:
            db = SessionLocal()
            try:
                backup_record = backup_repository.get_backup_for_tenant(db, tenant_id, backup_id)
                if backup_record is not None:
                    backup_service.merge_products_into_backup(db, backup_record, updated_products)
                    db.commit()
            finally:
                db.close()

        job.result = result
        job.status = "completed"
        job.progress = 100
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)


async def start_assign_images_by_sku(*, backup_record, woo_service, wp_url: str, wp_user: str, wp_app_password: str):
    job_id = str(uuid4())
    assign_images_jobs[job_id] = AssignImagesBySkuStatus(job_id=job_id, status="pending")
    asyncio.create_task(
        _run_assign_images_job(
            job_id=job_id,
            tenant_id=backup_record.tenant_id,
            backup_id=backup_record.id,
            woo_service=woo_service,
            wp_url=wp_url,
            wp_user=wp_user,
            wp_app_password=wp_app_password,
        )
    )
    return {"job_id": job_id}


async def get_assign_images_by_sku_status(*, job_id: str):
    job = assign_images_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment job not found")
    return job.model_dump()
