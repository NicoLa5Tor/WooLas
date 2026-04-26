import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from repositories import backup as backup_repository

MAX_BACKUPS_PER_TENANT = 3
MAX_BACKUP_AGE_HOURS = 2
RESTORE_BATCH_SIZE = 100
BACKUP_KIND_MANUAL = "manual"
BACKUP_KIND_SAFETY_RESTORE = "safety_restore"
BACKUP_KIND_RESTORED_STATE = "restored_state"
RESTORE_HISTORY_KINDS = (BACKUP_KIND_SAFETY_RESTORE,)
VALID_OPERATIONAL_BACKUP_KINDS = (BACKUP_KIND_MANUAL,)
FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _backup_kind_label(backup_kind: str) -> str:
    if backup_kind == BACKUP_KIND_SAFETY_RESTORE:
        return "Backup de seguridad"
    if backup_kind == BACKUP_KIND_RESTORED_STATE:
        return "Registro legado de restauración"
    return "Backup operativo"


def _normalize_filename(filename: str | None, fallback_prefix: str) -> str:
    if not filename:
        return f"{fallback_prefix}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    cleaned = FILENAME_SAFE_RE.sub("_", filename.strip())
    if not cleaned:
        cleaned = f"{fallback_prefix}.json"
    if not cleaned.lower().endswith(".json"):
        cleaned = f"{cleaned}.json"
    return f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{cleaned}"


def _enforce_backup_limit(db: Session, tenant_id, preserve_backup_ids: set[UUID] | None = None) -> None:
    preserve_backup_ids = preserve_backup_ids or set()
    backups = backup_repository.list_oldest_backups_for_tenant(db, tenant_id, [BACKUP_KIND_MANUAL])
    removable = [record for record in backups if record.id not in preserve_backup_ids]
    overflow = len(backups) - MAX_BACKUPS_PER_TENANT
    if overflow <= 0:
        return

    for record in removable[:overflow]:
        backup_repository.delete_backup_record(db, record)


def _store_backup_payload(
    db: Session,
    *,
    tenant_id,
    products: list[dict],
    backup_kind: str,
    filename_prefix: str = "backup",
    preserve_backup_ids: set[UUID] | None = None,
    explicit_filename: str | None = None,
):
    filename = explicit_filename or f"{filename_prefix}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    record = backup_repository.create_backup_record(
        db,
        tenant_id=tenant_id,
        filename=filename,
        file_path="db://backup_records",
        backup_kind=backup_kind,
        payload=products,
        product_count=len(products),
    )
    preserve_ids = set(preserve_backup_ids or set())
    preserve_ids.add(record.id)
    if backup_kind == BACKUP_KIND_MANUAL:
        _enforce_backup_limit(db, tenant_id, preserve_ids)
    db.commit()
    return record


def _serialize_backup_record(record) -> dict:
    return {
        "id": str(record.id),
        "filename": record.filename,
        "backup_kind": record.backup_kind,
        "backup_kind_label": _backup_kind_label(record.backup_kind),
        "product_count": record.product_count,
        "created_at": record.created_at.isoformat(),
    }


def _build_restore_payload(product: dict) -> dict:
    payload = {
        "id": int(product["id"]),
        "name": product.get("name"),
        "slug": product.get("slug") or "",
        "type": product.get("type") or "simple",
        "regular_price": product.get("regular_price") or "",
        "sale_price": product.get("sale_price") or "",
        "date_on_sale_from": product.get("date_on_sale_from"),
        "date_on_sale_to": product.get("date_on_sale_to"),
        "description": product.get("description") or "",
        "short_description": product.get("short_description") or "",
        "status": product.get("status") or "publish",
        "featured": bool(product.get("featured")),
        "catalog_visibility": product.get("catalog_visibility") or "visible",
        "manage_stock": bool(product.get("manage_stock")),
        "stock_quantity": product.get("stock_quantity"),
        "stock_status": product.get("stock_status") or "instock",
        "backorders": product.get("backorders") or "no",
        "sold_individually": bool(product.get("sold_individually")),
        "low_stock_amount": product.get("low_stock_amount"),
        "weight": product.get("weight") or "",
        "dimensions": {
            "length": str((product.get("dimensions") or {}).get("length") or ""),
            "width": str((product.get("dimensions") or {}).get("width") or ""),
            "height": str((product.get("dimensions") or {}).get("height") or ""),
        },
        "shipping_class": product.get("shipping_class") or "",
        "virtual": bool(product.get("virtual")),
        "downloadable": bool(product.get("downloadable")),
        "categories": [{"id": int(category["id"])} for category in product.get("categories", []) if category.get("id")],
        "tags": [{"id": int(tag["id"])} for tag in product.get("tags", []) if tag.get("id")],
        "images": [{"id": int(image["id"])} for image in product.get("images", []) if image.get("id")],
        "attributes": [
            {
                **({"id": int(attribute["id"])} if attribute.get("id") else {}),
                **({"name": attribute.get("name")} if attribute.get("name") else {}),
                "position": int(attribute.get("position") or 0),
                "visible": bool(attribute.get("visible", True)),
                "variation": bool(attribute.get("variation", False)),
                "options": [str(option) for option in attribute.get("options", []) if str(option).strip()],
            }
            for attribute in product.get("attributes", [])
        ],
        "upsell_ids": [int(item) for item in product.get("upsell_ids", []) if str(item).isdigit()],
        "cross_sell_ids": [int(item) for item in product.get("cross_sell_ids", []) if str(item).isdigit()],
        "downloads": [
            {"name": str(download.get("name") or ""), "file": str(download.get("file") or "")}
            for download in product.get("downloads", [])
            if download.get("name") and download.get("file")
        ],
        "download_limit": product.get("download_limit"),
        "download_expiry": product.get("download_expiry"),
        "meta_data": [
            {"key": str(meta.get("key") or ""), "value": meta.get("value")}
            for meta in product.get("meta_data", [])
            if str(meta.get("key") or "").strip()
        ],
    }
    if not payload["manage_stock"]:
        payload["stock_quantity"] = None
    return payload


def _validate_imported_products(products: object) -> list[dict]:
    if not isinstance(products, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo debe contener una lista JSON de productos")
    if not products:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo está vacío")

    normalized: list[dict] = []
    for index, item in enumerate(products, start=1):
        if not isinstance(item, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"El producto en la posición {index} no es válido")
        if "id" not in item:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"El producto en la posición {index} no tiene campo id")
        try:
            item_id = int(item["id"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"El id del producto en la posición {index} no es válido")

        normalized_item = dict(item)
        normalized_item["id"] = item_id
        normalized.append(normalized_item)

    return normalized


async def create_backup(
    db: Session,
    tenant,
    woo_service,
    preserve_backup_ids: set[UUID] | None = None,
    filename_prefix: str = "backup",
    backup_kind: str = BACKUP_KIND_MANUAL,
) -> dict:
    products = await woo_service.fetch_all_products()
    record = _store_backup_payload(
        db,
        tenant_id=tenant.id,
        products=products,
        backup_kind=backup_kind,
        filename_prefix=filename_prefix,
        preserve_backup_ids=preserve_backup_ids,
    )
    return _serialize_backup_record(record)


async def import_backup_file(db: Session, tenant_id, filename: str | None, file_bytes: bytes) -> dict:
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Debes seleccionar un archivo JSON")

    try:
        raw_payload = json.loads(file_bytes.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo no contiene un JSON válido")

    products = _validate_imported_products(raw_payload)
    record = _store_backup_payload(
        db,
        tenant_id=tenant_id,
        products=products,
        backup_kind=BACKUP_KIND_MANUAL,
        filename_prefix="imported_backup",
        explicit_filename=_normalize_filename(filename, "imported_backup"),
    )
    return _serialize_backup_record(record)


async def restore_backup(db: Session, tenant, backup_id, woo_service) -> dict:
    target_record = backup_repository.get_backup_for_tenant(db, tenant.id, backup_id)
    if not target_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")

    safety_backup = await create_backup(
        db,
        tenant,
        woo_service,
        preserve_backup_ids={target_record.id},
        filename_prefix="pre_restore_backup",
        backup_kind=BACKUP_KIND_SAFETY_RESTORE,
    )

    products = target_record.payload or []
    updated = 0
    failed = 0
    errors: list[dict[str, str]] = []

    for start in range(0, len(products), RESTORE_BATCH_SIZE):
        chunk = products[start : start + RESTORE_BATCH_SIZE]
        payload = [_build_restore_payload(product) for product in chunk]
        response = await woo_service.batch_update(payload)
        updated_items = response.get("update", [])
        error_items = response.get("error", [])
        updated += len(updated_items)
        failed += len(error_items)
        for item in error_items:
            errors.append({
                "identifier": str(item.get("id") or item.get("sku") or "desconocido"),
                "error": item.get("error", "No se pudo restaurar el producto"),
            })

    return {
        "safety_backup": safety_backup,
        "updated": updated,
        "failed": failed,
        "errors": errors,
        "total_products": len(products),
    }


def list_backups(db: Session, tenant_id) -> dict:
    active_backups = backup_repository.list_backups_for_tenant(db, tenant_id, [BACKUP_KIND_MANUAL])
    restore_backups = backup_repository.list_backups_for_tenant(db, tenant_id, RESTORE_HISTORY_KINDS)
    return {
        "active_backups": [_serialize_backup_record(backup) for backup in active_backups],
        "restore_backups": [_serialize_backup_record(backup) for backup in restore_backups],
    }


def get_backup_file(db: Session, tenant_id, backup_id) -> tuple[Path, str]:
    record = backup_repository.get_backup_for_tenant(db, tenant_id, backup_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    payload = json.dumps(record.payload, ensure_ascii=False, indent=2)
    return Path(record.filename), payload


def get_backup_file_by_filename(db: Session, tenant_id, filename: str) -> tuple[Path, str]:
    record = backup_repository.get_backup_by_filename_for_tenant(db, tenant_id, filename)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    return get_backup_file(db, tenant_id, record.id)


def get_latest_backup_or_raise(db: Session, tenant_id):
    record = backup_repository.get_latest_backup_for_tenant(db, tenant_id, VALID_OPERATIONAL_BACKUP_KINDS)
    if not record:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Debes crear un backup antes de continuar")
    return record


def require_fresh_backup(db: Session, tenant_id):
    record = get_latest_backup_or_raise(db, tenant_id)
    if record.created_at + timedelta(hours=MAX_BACKUP_AGE_HOURS) < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El backup actual tiene más de 2 horas. Debes crear un nuevo backup antes de continuar",
        )
    return record


def merge_products_into_backup(db: Session, backup_record, updated_products: list[dict]) -> None:
    if not updated_products:
        return

    product_map = {int(product["id"]): product for product in backup_record.payload}
    for product in updated_products:
        product_map[int(product["id"])] = product

    backup_record.payload = list(product_map.values())
    backup_record.product_count = len(backup_record.payload)
    backup_record.created_at = datetime.utcnow()
    backup_repository.update_backup_record(db, backup_record)
