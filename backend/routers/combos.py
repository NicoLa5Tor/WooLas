from fastapi import APIRouter, Depends, HTTPException, status

from core.dependencies import TenantAccessContext, require_recent_backup
from core.responses import success_response
from models.user import Role
from schemas.product import ProductCreate, ProductUpdate
from services import product as product_service
from services.woocommerce import WooCommerceService


router = APIRouter(prefix="/api/tenants/{tenant_id}/combos", tags=["combos"])


import html as _html
import re as _re

COMBO_META_FLAG = "_is_combo"
COMBO_META_CHILDREN = "_combo_children"
COMBO_META_MODE = "_combo_mode"  # "simple_html" | "grouped_native"

COMBO_BLOCK_START = "<!-- combo:children-start -->"
COMBO_BLOCK_END = "<!-- combo:children-end -->"
COMBO_BLOCK_RE = _re.compile(
    _re.escape(COMBO_BLOCK_START) + r".*?" + _re.escape(COMBO_BLOCK_END),
    _re.DOTALL,
)


def _is_combo(product: dict) -> bool:
    for meta in product.get("meta_data") or []:
        if str(meta.get("key") or "") == COMBO_META_FLAG and str(meta.get("value") or "").lower() in {"yes", "1", "true"}:
            return True
    # Backwards-compat: combos viejos creados como type=grouped sin meta flag
    if str(product.get("type") or "") == "grouped":
        return True
    return False


def _inject_combo_meta(payload, children_ids: list[int], mode: str) -> None:
    extra = [
        {"key": COMBO_META_FLAG, "value": "yes"},
        {"key": COMBO_META_CHILDREN, "value": ",".join(str(i) for i in children_ids)},
        {"key": COMBO_META_MODE, "value": mode},
    ]
    existing = list(payload.meta_data or [])
    existing = [m for m in existing if m.key not in {COMBO_META_FLAG, COMBO_META_CHILDREN, COMBO_META_MODE}]
    from schemas.product import ProductMetaDataInput
    for item in extra:
        existing.append(ProductMetaDataInput(**item))
    payload.meta_data = existing


def _build_combo_children_html(children_products: list[dict]) -> str:
    rows = []
    for c in children_products:
        name = _html.escape(str(c.get("name") or ""))
        sku = _html.escape(str(c.get("sku") or ""))
        permalink = _html.escape(str(c.get("permalink") or ""))
        short = _html.unescape(str(c.get("short_description") or ""))
        short = _re.sub(r"<[^>]+>", "", short).strip()
        short = _html.escape(short[:140])
        images = c.get("images") or []
        img_src = _html.escape(str((images[0] or {}).get("src") or "")) if images else ""
        img_html = (
            f'<img src="{img_src}" alt="{name}" style="width:70px;height:70px;object-fit:cover;border-radius:8px;display:block" />'
            if img_src else ""
        )

        cell_content = (
            f'<strong style="color:#0f172a">{name}</strong>'
            + (f'<br><small style="color:#64748b">SKU: {sku}</small>' if sku else "")
            + (f'<br><span style="color:#475569">{short}</span>' if short else "")
        )

        if permalink:
            row = (
                f'<tr style="border-bottom:1px solid #e5e7eb">'
                f'<td style="padding:8px;width:80px">'
                f'<a href="{permalink}" style="display:block">{img_html}</a>'
                f'</td>'
                f'<td style="padding:8px">'
                f'<a href="{permalink}" style="text-decoration:none;color:inherit;display:block">{cell_content}</a>'
                f' <a href="{permalink}" style="display:inline-block;margin-top:6px;font-size:12px;color:#2563eb;text-decoration:underline">Ver producto →</a>'
                f'</td></tr>'
            )
        else:
            row = (
                f'<tr style="border-bottom:1px solid #e5e7eb">'
                f'<td style="padding:8px;width:80px">{img_html}</td>'
                f'<td style="padding:8px">{cell_content}</td></tr>'
            )
        rows.append(row)
    body = "".join(rows) if rows else '<tr><td style="padding:8px;color:#64748b">Combo sin productos</td></tr>'
    return (
        f'{COMBO_BLOCK_START}\n'
        '<div class="combo-children" style="margin-top:16px">'
        '<h3 style="margin:0 0 12px 0">Este combo incluye:</h3>'
        '<table style="width:100%;border-collapse:collapse;border-top:1px solid #e5e7eb">'
        f'{body}'
        '</table>'
        '</div>\n'
        f'{COMBO_BLOCK_END}'
    )


def _strip_combo_block(text: str | None) -> str:
    if not text:
        return ""
    return COMBO_BLOCK_RE.sub("", text).strip()


def _resolve_children_from_backup(backup_payload: list[dict], children_ids: list[int]) -> list[dict]:
    by_id = {int(p.get("id") or 0): p for p in backup_payload if p.get("id") is not None}
    return [by_id[cid] for cid in children_ids if cid in by_id]


@router.get("")
async def list_combos(
    page: int = 1,
    search: str | None = None,
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    combos = [p for p in context.backup_record.payload if _is_combo(p)]
    if search:
        term = search.strip().lower()
        combos = [
            p for p in combos
            if term in str(p.get("name", "")).lower()
            or term in str(p.get("sku", "")).lower()
        ]
    page_size = 50
    total = len(combos)
    total_pages = max(1, (total + page_size - 1) // page_size)
    start = (page - 1) * page_size
    return success_response({
        "items": combos[start:start + page_size],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    })


VALID_MODES = {"sum_children", "custom_price"}


def _sum_children_price(children_products: list[dict], field: str) -> str:
    total = 0.0
    any_value = False
    for c in children_products:
        raw = str(c.get(field) or "").strip()
        if not raw:
            continue
        try:
            total += float(raw)
            any_value = True
        except ValueError:
            continue
    if not any_value:
        return ""
    if total == int(total):
        return str(int(total))
    return f"{total:.2f}"


def _apply_combo_mode(payload, children: list[int], mode: str, backup_payload: list[dict]) -> None:
    # type=simple SIEMPRE para que precio custom funcione + permitir HTML hijos
    payload.type = "simple"
    payload.grouped_products = None
    child_products = _resolve_children_from_backup(backup_payload, children)

    # Hijos visibles arriba del add-to-cart → short_description
    html_block = _build_combo_children_html(child_products)
    clean_short = _strip_combo_block(getattr(payload, "short_description", "") or "")
    payload.short_description = (clean_short + "\n\n" + html_block).strip() if clean_short else html_block

    # Limpiar description larga por si quedó un block viejo
    if getattr(payload, "description", None):
        payload.description = _strip_combo_block(payload.description)

    if mode == "sum_children":
        reg_sum = _sum_children_price(child_products, "regular_price")
        sale_sum = _sum_children_price(child_products, "sale_price")
        # Solo sobreescribe si pudimos calcular un total
        if reg_sum:
            payload.regular_price = reg_sum
        if sale_sum:
            payload.sale_price = sale_sum

    _inject_combo_meta(payload, children, mode)


@router.post("")
async def create_combo(
    payload: ProductCreate,
    mode: str = "custom_price",
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    children = list(payload.grouped_products or [])
    if not children:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El combo debe tener al menos un producto hijo")
    if mode not in VALID_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Modo inválido. Usa: {', '.join(VALID_MODES)}")
    _apply_combo_mode(payload, children, mode, context.backup_record.payload)
    woo_service = WooCommerceService(**context.credentials)
    return success_response(
        await product_service.create_product(
            payload=payload,
            backup_record=context.backup_record,
            db=context.db,
            woo_service=woo_service,
        )
    )


@router.put("/{combo_id}")
async def update_combo(
    combo_id: int,
    payload: ProductUpdate,
    mode: str = "custom_price",
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    if mode not in VALID_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Modo inválido. Usa: {', '.join(VALID_MODES)}")
    children = list(payload.grouped_products or [])
    if children:
        _apply_combo_mode(payload, children, mode, context.backup_record.payload)
    else:
        payload.type = "simple"
    woo_service = WooCommerceService(**context.credentials)
    return success_response(
        await product_service.update_product(
            product_id=combo_id,
            payload=payload,
            backup_record=context.backup_record,
            db=context.db,
            woo_service=woo_service,
        )
    )


@router.delete("/{combo_id}")
async def delete_combo(
    combo_id: int,
    force: bool = False,
    context: TenantAccessContext = Depends(require_recent_backup(Role.CLIENT)),
):
    woo_service = WooCommerceService(**context.credentials)
    result = await woo_service.delete_product(combo_id, force=force)
    # Refresh backup to drop the deleted product
    from services import backup as backup_service
    backup_service.remove_product_from_backup(context.db, context.backup_record, combo_id)
    context.db.commit()
    return success_response(result)
