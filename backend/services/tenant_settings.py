"""Tenant settings — wrapper over WC settings REST + future local app settings."""
from typing import Any

from services.woocommerce import WooCommerceService


# Definición declarativa de toggles/configs expuestos en UI.
# Estructura: cada section = {key, label, description, fields: [...]}
# Cada field describe cómo leer/escribir contra WC.
SETTINGS_SECTIONS = [
    {
        "key": "inventory",
        "label": "Inventario",
        "description": "Control de stock y visibilidad por disponibilidad.",
        "fields": [
            {
                "key": "hide_out_of_stock",
                "label": "Ocultar productos sin stock del catálogo",
                "description": "Productos sin stock no aparecerán en shop, búsqueda ni listados públicos. Setting nativo WC.",
                "type": "boolean",
                "wc_group": "products",
                "wc_setting": "woocommerce_hide_out_of_stock_items",
                "true_value": "yes",
                "false_value": "no",
            },
            {
                "key": "stock_format",
                "label": "Formato visualización stock",
                "description": "Cómo se muestra la cantidad disponible en frontend.",
                "type": "select",
                "wc_group": "products",
                "wc_setting": "woocommerce_stock_format",
                "options": [
                    {"value": "", "label": "Siempre mostrar cantidad (ej. 12 disponibles)"},
                    {"value": "low_amount", "label": "Solo si stock bajo (ej. ¡Solo 2 disponibles!)"},
                    {"value": "no_amount", "label": "Nunca mostrar cantidad"},
                ],
            },
            {
                "key": "notify_low_stock",
                "label": "Notificar stock bajo",
                "description": "Email al admin cuando un producto baja del umbral.",
                "type": "boolean",
                "wc_group": "products",
                "wc_setting": "woocommerce_notify_low_stock",
                "true_value": "yes",
                "false_value": "no",
            },
            {
                "key": "low_stock_threshold",
                "label": "Umbral stock bajo",
                "description": "Cantidad a partir de la cual se considera stock bajo.",
                "type": "number",
                "wc_group": "products",
                "wc_setting": "woocommerce_notify_low_stock_amount",
            },
        ],
    },
    {
        "key": "general",
        "label": "General",
        "description": "Unidades y configuración base de la tienda.",
        "fields": [
            {
                "key": "weight_unit",
                "label": "Unidad de peso",
                "type": "select",
                "wc_group": "products",
                "wc_setting": "woocommerce_weight_unit",
                "options": [
                    {"value": "kg", "label": "Kilogramos (kg)"},
                    {"value": "g", "label": "Gramos (g)"},
                    {"value": "lbs", "label": "Libras (lbs)"},
                    {"value": "oz", "label": "Onzas (oz)"},
                ],
            },
            {
                "key": "dimension_unit",
                "label": "Unidad de dimensión",
                "type": "select",
                "wc_group": "products",
                "wc_setting": "woocommerce_dimension_unit",
                "options": [
                    {"value": "m", "label": "Metros (m)"},
                    {"value": "cm", "label": "Centímetros (cm)"},
                    {"value": "mm", "label": "Milímetros (mm)"},
                    {"value": "in", "label": "Pulgadas (in)"},
                    {"value": "yd", "label": "Yardas (yd)"},
                ],
            },
            {
                "key": "enable_reviews",
                "label": "Habilitar reseñas de productos",
                "type": "boolean",
                "wc_group": "products",
                "wc_setting": "woocommerce_enable_reviews",
                "true_value": "yes",
                "false_value": "no",
            },
            {
                "key": "enable_ajax_add_to_cart",
                "label": "Añadir al carrito con AJAX",
                "description": "Permite agregar productos sin recargar la página.",
                "type": "boolean",
                "wc_group": "products",
                "wc_setting": "woocommerce_enable_ajax_add_to_cart",
                "true_value": "yes",
                "false_value": "no",
            },
        ],
    },
]


def _normalize_value(field: dict, raw_value: Any) -> Any:
    """Convierte el value crudo de WC a algo útil para frontend."""
    if field["type"] == "boolean":
        return str(raw_value) == field.get("true_value", "yes")
    if field["type"] == "number":
        try:
            return int(raw_value) if raw_value not in (None, "") else 0
        except (ValueError, TypeError):
            return 0
    return "" if raw_value is None else str(raw_value)


def _serialize_value_for_wc(field: dict, value: Any) -> Any:
    if field["type"] == "boolean":
        return field.get("true_value", "yes") if bool(value) else field.get("false_value", "no")
    if field["type"] == "number":
        try:
            return int(value)
        except (ValueError, TypeError):
            return 0
    return str(value) if value is not None else ""


async def get_all_settings(woo_service: WooCommerceService) -> list[dict]:
    """Lee TODOS los toggles definidos desde WC, devuelve sections con current values."""
    result_sections = []
    for section in SETTINGS_SECTIONS:
        fields_out = []
        for field in section["fields"]:
            try:
                wc_data = await woo_service.get_setting(field["wc_group"], field["wc_setting"])
                raw_value = wc_data.get("value")
            except Exception as exc:
                fields_out.append({**_field_public(field), "value": None, "error": str(exc)[:120]})
                continue
            fields_out.append({**_field_public(field), "value": _normalize_value(field, raw_value)})
        result_sections.append({
            "key": section["key"],
            "label": section["label"],
            "description": section["description"],
            "fields": fields_out,
        })
    return result_sections


def _field_public(field: dict) -> dict:
    """Solo expone metadata del field al frontend (no internals WC)."""
    public = {
        "key": field["key"],
        "label": field["label"],
        "description": field.get("description"),
        "type": field["type"],
    }
    if "options" in field:
        public["options"] = field["options"]
    return public


def _find_field(section_key: str, field_key: str) -> dict | None:
    for section in SETTINGS_SECTIONS:
        if section["key"] != section_key:
            continue
        for field in section["fields"]:
            if field["key"] == field_key:
                return field
    return None


async def update_setting(
    woo_service: WooCommerceService,
    section_key: str,
    field_key: str,
    value: Any,
) -> dict:
    field = _find_field(section_key, field_key)
    if not field:
        raise ValueError(f"Setting desconocido: {section_key}.{field_key}")
    wc_value = _serialize_value_for_wc(field, value)
    response = await woo_service.update_setting(field["wc_group"], field["wc_setting"], wc_value)
    return {**_field_public(field), "value": _normalize_value(field, response.get("value"))}
