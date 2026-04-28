from __future__ import annotations

import asyncio
import uuid
from io import BytesIO
from pathlib import Path
import re
from uuid import UUID
from difflib import SequenceMatcher

from fastapi import HTTPException, status
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

from core.config import settings
from repositories import import_draft as import_draft_repository
from schemas.imports import (
    ImportApplyResult,
    ImportExpectedField,
    ImportFormatAnalysis,
    ImportHeaderSuggestion,
    ImportImagesJobRowStatus,
    ImportImagesJobStatus,
)
from services import excel as excel_service
from services import media as media_service

DARK = "1E293B"
MID = "334155"
BLUE = "1D4ED8"
GREEN = "065F46"
PURPLE = "6B21A8"
TEAL = "0F766E"
ORANGE = "C2410C"
ALT = "F8FAFC"
WHITE = "FFFFFF"

thin = Side(style="thin", color="CBD5E1")
brd = Border(left=thin, right=thin, top=thin, bottom=thin)

COLUMN_DEFINITIONS = [
    {"key": "product_id", "label": "ID del producto", "group": "IDENTIFICACION", "color": DARK, "required": True},
    {"key": "sku", "label": "SKU", "group": "IDENTIFICACION", "color": DARK, "required": True},
    {"key": "name", "label": "Nombre", "group": "GENERAL", "color": MID, "required": True},
    {"key": "slug", "label": "Slug", "group": "GENERAL", "color": MID, "required": False},
    {"key": "type", "label": "Tipo", "group": "GENERAL", "color": MID, "required": True},
    {"key": "status", "label": "Estado", "group": "GENERAL", "color": MID, "required": True},
    {"key": "featured", "label": "Destacado", "group": "GENERAL", "color": MID, "required": False},
    {"key": "catalog_visibility", "label": "Visibilidad catalogo", "group": "GENERAL", "color": MID, "required": False},
    {"key": "regular_price", "label": "Precio regular", "group": "PRECIOS", "color": GREEN, "required": True},
    {"key": "sale_price", "label": "Precio oferta", "group": "PRECIOS", "color": GREEN, "required": False},
    {"key": "date_on_sale_from", "label": "Oferta desde", "group": "PRECIOS", "color": GREEN, "required": False},
    {"key": "date_on_sale_to", "label": "Oferta hasta", "group": "PRECIOS", "color": GREEN, "required": False},
    {"key": "description", "label": "Descripcion completa", "group": "DESCRIPCIONES", "color": TEAL, "required": False},
    {"key": "short_description", "label": "Descripcion corta", "group": "DESCRIPCIONES", "color": TEAL, "required": False},
    {"key": "manage_stock", "label": "Gestionar stock", "group": "INVENTARIO", "color": BLUE, "required": False},
    {"key": "stock_quantity", "label": "Cantidad stock", "group": "INVENTARIO", "color": BLUE, "required": False},
    {"key": "stock_status", "label": "Estado stock", "group": "INVENTARIO", "color": BLUE, "required": False},
    {"key": "backorders", "label": "Backorders", "group": "INVENTARIO", "color": BLUE, "required": False},
    {"key": "sold_individually", "label": "Venta individual", "group": "INVENTARIO", "color": BLUE, "required": False},
    {"key": "low_stock_amount", "label": "Alerta stock bajo", "group": "INVENTARIO", "color": BLUE, "required": False},
    {"key": "weight", "label": "Peso", "group": "ENVIO", "color": PURPLE, "required": False},
    {"key": "length", "label": "Largo", "group": "ENVIO", "color": PURPLE, "required": False},
    {"key": "width", "label": "Ancho", "group": "ENVIO", "color": PURPLE, "required": False},
    {"key": "height", "label": "Alto", "group": "ENVIO", "color": PURPLE, "required": False},
    {"key": "shipping_class", "label": "Clase de envio", "group": "ENVIO", "color": PURPLE, "required": False},
    {"key": "virtual", "label": "Virtual", "group": "ENVIO", "color": PURPLE, "required": False},
    {"key": "downloadable", "label": "Descargable", "group": "ENVIO", "color": PURPLE, "required": False},
    {"key": "image_principal_id", "label": "ID imagen principal", "group": "IMAGENES", "color": ORANGE, "required": False},
    {"key": "image_galeria_ids", "label": "IDs galeria", "group": "IMAGENES", "color": ORANGE, "required": False},
    {"key": "image_nombres", "label": "Nombres imagenes", "group": "IMAGENES", "color": ORANGE, "required": False},
    {"key": "attr1_nombre", "label": "Atributo 1 nombre", "group": "ATRIBUTOS", "color": "B45309", "required": False},
    {"key": "attr1_valores", "label": "Atributo 1 valores", "group": "ATRIBUTOS", "color": "B45309", "required": False},
    {"key": "attr2_nombre", "label": "Atributo 2 nombre", "group": "ATRIBUTOS", "color": "B45309", "required": False},
    {"key": "attr2_valores", "label": "Atributo 2 valores", "group": "ATRIBUTOS", "color": "B45309", "required": False},
    {"key": "category_ids", "label": "IDs categorias", "group": "RELACIONADOS", "color": "0369A1", "required": False},
    {"key": "tag_ids", "label": "IDs etiquetas", "group": "RELACIONADOS", "color": "0369A1", "required": False},
    {"key": "upsell_ids", "label": "IDs upsells", "group": "RELACIONADOS", "color": "0369A1", "required": False},
    {"key": "cross_sell_ids", "label": "IDs cross-sells", "group": "RELACIONADOS", "color": "0369A1", "required": False},
    {"key": "meta_key", "label": "Meta key", "group": "META DATA", "color": "4B5563", "required": False},
    {"key": "meta_value", "label": "Meta value", "group": "META DATA", "color": "4B5563", "required": False},
]

HEADER_LABELS = {item["key"]: item["label"] for item in COLUMN_DEFINITIONS}
HTML_TAG_RE = re.compile(r"<[^>]+>")
GROUP_RANGES = [
    (1, 2, "IDENTIFICACION", DARK),
    (3, 8, "GENERAL", MID),
    (9, 12, "PRECIOS", GREEN),
    (13, 14, "DESCRIPCIONES", TEAL),
    (15, 20, "INVENTARIO", BLUE),
    (21, 27, "ENVIO", PURPLE),
    (28, 30, "IMAGENES", ORANGE),
    (31, 34, "ATRIBUTOS", "B45309"),
    (35, 38, "RELACIONADOS", "0369A1"),
    (39, 40, "META DATA", "4B5563"),
]

import_apply_jobs: dict[str, ImportImagesJobStatus] = {}


def _draft_directory(tenant_id: UUID) -> Path:
    return settings.imports_dir / str(tenant_id)


def _draft_file_path(tenant_id: UUID, draft_id: UUID, original_filename: str) -> Path:
    safe_name = Path(original_filename or "import.xlsx").name
    return _draft_directory(tenant_id) / f"{draft_id}_{safe_name}"


def _serialize_draft(record) -> dict:
    return {
        "id": str(record.id),
        "tenant_id": str(record.tenant_id),
        "original_filename": record.original_filename,
        "headers": record.headers,
        "sample_rows": record.sample_rows,
        "row_count": record.row_count,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
    }


def _parse_xlsx_payload(file_bytes: bytes) -> tuple[list[str], list[dict[str, str]], int]:
    headers, rows = excel_service.parse_excel(file_bytes)
    return headers, rows[:5], len(rows)


def _parse_xlsx_source_payload(file_bytes: bytes) -> tuple[list[str], list[dict[str, str]], int]:
    headers, rows = excel_service.parse_excel(file_bytes, normalize_headers=False)
    return headers, rows[:5], len(rows)


def _write_file(path: Path, file_bytes: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(file_bytes)


def _remove_file(path_str: str) -> None:
    path = Path(path_str)
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def _expected_fields() -> list[ImportExpectedField]:
    return [ImportExpectedField(key=item["key"], label=item["label"], required=bool(item["required"])) for item in COLUMN_DEFINITIONS]


def _clean_header_label(value: str) -> str:
    cleaned = value.strip()
    if cleaned.startswith("* "):
        cleaned = cleaned[2:].strip()
    return cleaned


def _analyze_headers(source_headers: list[str], normalized_headers: list[str]) -> ImportFormatAnalysis:
    expected_labels = [item["label"] for item in COLUMN_DEFINITIONS]
    required_labels = [item["label"] for item in COLUMN_DEFINITIONS if item["required"]]
    typo_suggestions: list[ImportHeaderSuggestion] = []
    unknown_headers: list[str] = []
    cleaned_source_headers = [_clean_header_label(header) for header in source_headers]

    for original_header, header in zip(source_headers, cleaned_source_headers, strict=False):
        if header in expected_labels:
            continue
        scores = sorted(
            ((label, SequenceMatcher(None, header.lower(), label.lower()).ratio()) for label in expected_labels),
            key=lambda item: item[1],
            reverse=True,
        )
        best_label, best_score = scores[0] if scores else ("", 0.0)
        if best_score >= 0.72:
            typo_suggestions.append(ImportHeaderSuggestion(provided=original_header, expected=best_label, confidence=round(best_score, 2)))
        else:
            unknown_headers.append(original_header)

    present_labels = set(cleaned_source_headers)
    suggested_labels = {item.expected for item in typo_suggestions}
    missing_required = [label for label in required_labels if label not in present_labels and label not in suggested_labels]

    if not typo_suggestions and not unknown_headers and not missing_required:
        status = "ready"
    elif typo_suggestions and not unknown_headers and not missing_required:
        status = "typos"
    else:
        status = "refactor_required"

    return ImportFormatAnalysis(
        status=status,
        source_headers=source_headers,
        normalized_headers=normalized_headers,
        typo_suggestions=typo_suggestions,
        missing_required=missing_required,
        unknown_headers=unknown_headers,
        expected_fields=_expected_fields(),
    )


def _build_draft_response(record) -> dict:
    file_bytes = Path(record.storage_path).read_bytes() if Path(record.storage_path).exists() else b""
    source_headers, _, _ = _parse_xlsx_source_payload(file_bytes) if file_bytes else ([], [], 0)
    analysis = _analyze_headers(source_headers, record.headers or [])
    payload = _serialize_draft(record)
    payload["source_headers"] = source_headers
    payload["format_analysis"] = analysis.model_dump()
    payload["sample_rows"] = record.sample_rows or []
    return payload


def _format_bool(value: object) -> str:
    return "true" if bool(value) else "false"


def _join_ids(items: list[object]) -> str:
    return ";".join(str(item) for item in items if item not in {None, ""})


def _join_taxonomy_ids(items: list[dict]) -> str:
    return ";".join(str(item.get("id")) for item in items if item.get("id") is not None)


def _join_attribute_options(attribute: dict | None) -> str:
    if not attribute:
        return ""
    return ";".join(str(option) for option in attribute.get("options", []) if str(option).strip())


def _image_name(image: dict) -> str:
    return (
        str(image.get("name") or "").strip()
        or PurePosixPath(str(image.get("src") or "")).name
        or f"imagen-{image.get('id', '')}"
    )


def _html_to_plain_text(value: object) -> str:
    text = str(value or "")
    if not text:
        return ""
    text = re.sub(r"</p>\s*<p>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = HTML_TAG_RE.sub("", text)
    text = text.replace("&nbsp;", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _autosize_columns(sheet, *, min_width: int = 12, max_width: int = 48) -> None:
    for column_cells in sheet.columns:
        values = [str(cell.value).strip() for cell in column_cells if cell.value is not None]
        if not values:
            continue
        real_cell = next((cell for cell in column_cells if hasattr(cell, "column_letter")), None)
        if real_cell is None:
            continue
        width = max(len(value) for value in values) + 2
        sheet.column_dimensions[real_cell.column_letter].width = max(min_width, min(width, max_width))


def _product_to_template_row(product: dict) -> list[str]:
    dimensions = product.get("dimensions") or {}
    images = product.get("images") or []
    attributes = product.get("attributes") or []
    attr1 = attributes[0] if len(attributes) > 0 else None
    attr2 = attributes[1] if len(attributes) > 1 else None
    meta = next((item for item in product.get("meta_data", []) if str(item.get("key") or "").strip()), None)

    return [
        str(product.get("id") or ""),
        str(product.get("sku") or ""),
        str(product.get("name") or ""),
        str(product.get("slug") or ""),
        str(product.get("type") or ""),
        str(product.get("status") or ""),
        _format_bool(product.get("featured")),
        str(product.get("catalog_visibility") or ""),
        str(product.get("regular_price") or ""),
        str(product.get("sale_price") or ""),
        str(product.get("date_on_sale_from") or ""),
        str(product.get("date_on_sale_to") or ""),
        _html_to_plain_text(product.get("description")),
        _html_to_plain_text(product.get("short_description")),
        _format_bool(product.get("manage_stock")),
        "" if product.get("stock_quantity") is None else str(product.get("stock_quantity")),
        str(product.get("stock_status") or ""),
        str(product.get("backorders") or ""),
        _format_bool(product.get("sold_individually")),
        "" if product.get("low_stock_amount") is None else str(product.get("low_stock_amount")),
        str(product.get("weight") or ""),
        str(dimensions.get("length") or ""),
        str(dimensions.get("width") or ""),
        str(dimensions.get("height") or ""),
        str(product.get("shipping_class") or ""),
        _format_bool(product.get("virtual")),
        _format_bool(product.get("downloadable")),
        str(images[0].get("id") or "") if images else "",
        _join_ids([image.get("id") for image in images[1:]]),
        ";".join(_image_name(image) for image in images if image),
        str(attr1.get("name") or "") if attr1 else "",
        _join_attribute_options(attr1),
        str(attr2.get("name") or "") if attr2 else "",
        _join_attribute_options(attr2),
        _join_taxonomy_ids(product.get("categories", [])),
        _join_taxonomy_ids(product.get("tags", [])),
        _join_ids(product.get("upsell_ids", [])),
        _join_ids(product.get("cross_sell_ids", [])),
        str(meta.get("key") or "") if meta else "",
        str(meta.get("value") or "") if meta else "",
    ]


def _build_template_workbook(rows: list[list[str]], title: str, *, highlight_first_row: bool) -> bytes:
    workbook = Workbook()
    ws = workbook.active
    ws.title = "productos"
    ws.freeze_panes = "C4"
    ws.sheet_view.showGridLines = False

    ws.merge_cells("A1:AN1")
    c = ws["A1"]
    c.value = title
    c.font = Font(bold=True, size=13, color=WHITE, name="Arial")
    c.fill = PatternFill("solid", start_color=DARK)
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30

    for start_col, end_col, label, color in GROUP_RANGES:
        ws.merge_cells(start_row=2, start_column=start_col, end_row=2, end_column=end_col)
        c = ws.cell(row=2, column=start_col)
        c.value = label
        c.font = Font(bold=True, color=WHITE, size=8, name="Arial")
        c.fill = PatternFill("solid", start_color=color)
        c.alignment = Alignment(horizontal="center", vertical="center")
        for col in range(start_col, end_col + 1):
            ws.cell(row=2, column=col).fill = PatternFill("solid", start_color=color)
    ws.row_dimensions[2].height = 18

    for col, item in enumerate(COLUMN_DEFINITIONS, 1):
        c = ws.cell(row=3, column=col)
        c.value = ("* " if item["required"] else "") + item["label"]
        c.font = Font(bold=True, color=WHITE, size=8, name="Arial")
        c.fill = PatternFill("solid", start_color=item["color"])
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = brd
    ws.row_dimensions[3].height = 30

    for row_index, row in enumerate(rows, start=4):
        is_highlighted = highlight_first_row and row_index == 4
        bg = "FEF9C3" if is_highlighted else (WHITE if row_index % 2 == 0 else ALT)
        font_color = "92400E" if is_highlighted else DARK
        italic = is_highlighted
        for col, val in enumerate(row, 1):
            c = ws.cell(row=row_index, column=col, value=val)
            c.font = Font(size=9, name="Arial", color=font_color, italic=italic)
            c.fill = PatternFill("solid", start_color=bg)
            c.alignment = Alignment(horizontal="left", vertical="center")
            c.border = brd

    wi = workbook.create_sheet("instrucciones")
    wi.sheet_view.showGridLines = False

    wi.merge_cells("A1:D1")
    c = wi["A1"]
    c.value = "INSTRUCCIONES DE USO"
    c.font = Font(bold=True, size=13, color=WHITE, name="Arial")
    c.fill = PatternFill("solid", start_color=DARK)
    c.alignment = Alignment(horizontal="center", vertical="center")
    wi.row_dimensions[1].height = 28

    for col, header in enumerate(["Campo", "Obligatorio", "Valores aceptados", "Notas"], 1):
        c = wi.cell(row=2, column=col, value=header)
        c.font = Font(bold=True, color=WHITE, size=9, name="Arial")
        c.fill = PatternFill("solid", start_color=MID)
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = brd

    instrucciones = [
        ("ID del producto", "Si (o SKU)", "Numero entero", "ID de WooCommerce. Usar para empatar producto existente."),
        ("SKU", "Si (o ID)", "Texto libre", "Codigo unico del producto. Preferido sobre el ID."),
        ("Nombre", "Si", "Texto libre", "Nombre visible del producto en la tienda."),
        ("Slug", "No", "Texto sin espacios", "Se genera automaticamente si se deja vacio."),
        ("Tipo", "Si", "simple | variable | grouped | external", ""),
        ("Estado", "Si", "publish | draft | pending | private", ""),
        ("Destacado", "No", "true | false", ""),
        ("Visibilidad catalogo", "No", "visible | catalog | search | hidden", ""),
        ("Precio regular", "Si", "Numero", "Ej: 129900"),
        ("Precio oferta", "No", "Numero", ""),
        ("Oferta desde / hasta", "No", "ISO 8601", "Ej: 2026-04-25T08:00:00Z"),
        ("Gestionar stock", "No", "true | false", ""),
        ("Cantidad stock", "No", "Numero entero", "Solo aplica si gestionas stock."),
        ("Estado stock", "No", "instock | outofstock | onbackorder", ""),
        ("Backorders", "No", "no | notify | yes", ""),
        ("Peso / Largo / Ancho / Alto", "No", "Numero decimal", "Dimensiones del producto."),
        ("IDs imagenes", "No", "IDs separados por ;", "La principal va aparte de la galeria."),
        ("Atributos", "No", "Nombre + valores separados por ;", "Actualmente la plantilla exporta 2 atributos visibles."),
        ("IDs categorias / etiquetas", "No", "IDs separados por ;", ""),
        ("IDs upsells / cross-sells", "No", "IDs separados por ;", ""),
        ("Meta key / value", "No", "Texto libre", "Se exporta la primera meta_data util."),
    ]
    for i, row in enumerate(instrucciones):
        bg = WHITE if i % 2 == 0 else ALT
        for col, val in enumerate(row, 1):
            c = wi.cell(row=i + 3, column=col, value=val)
            c.font = Font(size=9, name="Arial", color=DARK)
            c.fill = PatternFill("solid", start_color=bg)
            c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            c.border = brd
        wi.row_dimensions[i + 3].height = 28

    wr = workbook.create_sheet("referencia")
    wr.sheet_view.showGridLines = False
    wr.merge_cells("A1:H1")
    c = wr["A1"]
    c.value = "REFERENCIA DE VALORES VALIDOS"
    c.font = Font(bold=True, size=13, color=WHITE, name="Arial")
    c.fill = PatternFill("solid", start_color=DARK)
    c.alignment = Alignment(horizontal="center", vertical="center")
    wr.row_dimensions[1].height = 28

    refs = [
        ("Tipo", ["simple", "variable", "grouped", "external"]),
        ("Estado", ["publish", "draft", "pending", "private"]),
        ("Visibilidad catalogo", ["visible", "catalog", "search", "hidden"]),
        ("Estado stock", ["instock", "outofstock", "onbackorder"]),
        ("Backorders", ["no", "notify", "yes"]),
        ("Booleanos", ["true", "false"]),
        ("Separador listas", ["; (punto y coma)"]),
        ("Formato fechas", ["ISO 8601: 2026-04-25T08:00:00Z"]),
    ]
    for col_ref, (field, values) in enumerate(refs, 1):
        c = wr.cell(row=2, column=col_ref, value=field)
        c.font = Font(bold=True, color=WHITE, size=9, name="Arial")
        c.fill = PatternFill("solid", start_color=MID)
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = brd
        wr.column_dimensions[get_column_letter(col_ref)].width = 28
        for idx, val in enumerate(values):
            c = wr.cell(row=3 + idx, column=col_ref, value=val)
            c.font = Font(size=9, name="Arial", color=DARK)
            c.fill = PatternFill("solid", start_color=WHITE if idx % 2 == 0 else ALT)
            c.alignment = Alignment(horizontal="center", vertical="center")
            c.border = brd

    _autosize_columns(ws, min_width=12, max_width=44)
    _autosize_columns(wi, min_width=16, max_width=56)
    _autosize_columns(wr, min_width=18, max_width=32)

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def save_import_draft(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    filename: str,
    file_bytes: bytes,
) -> dict:
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Debes seleccionar un archivo .xlsx")

    try:
        headers, sample_rows, row_count = _parse_xlsx_payload(file_bytes)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"No se pudo leer el Excel: {exc}")

    existing = import_draft_repository.get_import_draft_for_tenant(db, tenant_id)
    if existing is not None:
        _remove_file(existing.storage_path)

    draft_id = uuid.uuid4()
    storage_path = _draft_file_path(tenant_id, draft_id, filename)
    _write_file(storage_path, file_bytes)

    record = import_draft_repository.upsert_import_draft(
        db,
        tenant_id=tenant_id,
        created_by_user_id=user_id,
        original_filename=filename or "import.xlsx",
        storage_path=str(storage_path),
        headers=headers,
        sample_rows=sample_rows,
        row_count=row_count,
    )
    db.commit()
    return _build_draft_response(record)


def get_current_import_draft(db: Session, tenant_id: UUID) -> dict | None:
    record = import_draft_repository.get_import_draft_for_tenant(db, tenant_id)
    return None if record is None else _build_draft_response(record)


def require_current_import_draft(db: Session, tenant_id: UUID):
    record = import_draft_repository.get_import_draft_for_tenant(db, tenant_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No hay un Excel guardado para este cliente")
    return record


def get_import_draft(db: Session, tenant_id: UUID, draft_id: UUID):
    record = import_draft_repository.get_import_draft_by_id(db, tenant_id, draft_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import draft not found")
    return record


def get_import_draft_bytes(db: Session, tenant_id: UUID, draft_id: UUID) -> bytes:
    record = get_import_draft(db, tenant_id, draft_id)
    path = Path(record.storage_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imported file not found")
    return path.read_bytes()


def get_current_import_draft_bytes(db: Session, tenant_id: UUID) -> tuple[dict, bytes]:
    record = require_current_import_draft(db, tenant_id)
    path = Path(record.storage_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imported file not found")
    return _build_draft_response(record), path.read_bytes()


def build_import_template() -> tuple[str, bytes]:
    sample = [
        "12345", "03330154", "Producto ejemplo", "producto-ejemplo",
        "variable", "publish", "true", "visible",
        "129900", "119900", "2026-04-25T08:00:00Z", "2026-04-30T23:59:59Z",
        "<p>Descripcion completa.</p>", "<p>Descripcion corta.</p>",
        "true", "10", "instock", "no", "false", "2",
        "1.2", "20", "10", "5", "hogar", "false", "false",
        "501", "502;503", "03330154-Nombre-Marca-1.jpg",
        "Color", "Rojo;Azul", "Talla", "S;M;L",
        "12;15", "3;9", "220;221", "330;331",
        "_origen_excel", "campana_mayo",
    ]
    return "plantilla_productos_woocommerce.xlsx", _build_template_workbook([sample], "PLANTILLA DE IMPORTACION - WOOCOMMERCE", highlight_first_row=True)


def build_products_export(products: list[dict]) -> tuple[str, bytes]:
    rows = [_product_to_template_row(product) for product in products]
    return "productos_woocommerce.xlsx", _build_template_workbook(rows, "EXPORTACION DE PRODUCTOS - WOOCOMMERCE", highlight_first_row=False)


def _canonical_row_to_template_row(row: dict[str, str]) -> list[str]:
    return [str(row.get(item["key"]) or "") for item in COLUMN_DEFINITIONS]


def refactor_import_draft(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    mapping: dict[str, str | None],
) -> dict:
    draft, file_bytes = get_current_import_draft_bytes(db, tenant_id)
    source_headers, rows = excel_service.parse_excel(file_bytes, normalize_headers=False)
    if not source_headers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El Excel no tiene columnas para refactorizar")

    canonical_rows: list[dict[str, str]] = []
    for row in rows:
        canonical_row: dict[str, str] = {}
        for item in COLUMN_DEFINITIONS:
            source_header = mapping.get(item["key"])
            canonical_row[item["key"]] = row.get(source_header or "", "") if source_header else ""
        canonical_rows.append(canonical_row)

    workbook_bytes = _build_template_workbook(
        [_canonical_row_to_template_row(row) for row in canonical_rows],
        "EXCEL REFACTORIZADO - WOOCOMMERCE",
        highlight_first_row=False,
    )
    return save_import_draft(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        filename=f"refactorizado_{draft['original_filename']}",
        file_bytes=workbook_bytes,
    )


async def preview_import_draft(*, db: Session, tenant_id: UUID, selected_fields: list[str], products: list[dict]):
    _, file_bytes = get_current_import_draft_bytes(db, tenant_id)
    headers, rows = excel_service.parse_excel(file_bytes)
    excel_service.validate_selected_fields(headers, selected_fields)
    preview = await excel_service.generate_bulk_preview(rows=rows, selected_fields=selected_fields, products=products)
    return {"headers": headers, **preview}


async def _run_import_images_job(
    *,
    job_id: str,
    tenant_id: UUID,
    backup_id: UUID,
    rows: list[dict[str, str]],
    selected_row_indexes: list[int] | None,
    products: list[dict],
    credentials: dict[str, str],
    wp_url: str,
    wp_user: str,
    wp_app_password: str,
):
    from core.database import SessionLocal
    from repositories import backup as backup_repository
    from services import backup as backup_service
    from services.woocommerce import WooCommerceService

    job = import_apply_jobs[job_id]
    woo_service = WooCommerceService(**credentials)
    updated_products: list[dict] = []
    result = ImportApplyResult()
    job_db = None

    try:
        job.status = "running"
        job.stage = "indexing"
        job.current_identifier = "Preparando imágenes"
        job.current_product_name = "Cargando media library y resolviendo nombres"
        job_db = SessionLocal()

        async def on_media_progress(*, processed_pages: int, total_pages: int, from_cache: bool):
            if from_cache:
                job.stage = "indexing"
                job.current_identifier = "Media library lista"
                job.current_product_name = "Usando caché local de imágenes"
                return
            job.stage = "indexing"
            job.current_identifier = "Cargando media library"
            job.current_product_name = f"Descargando páginas {processed_pages} de {total_pages}"
            preload_progress = 5 if total_pages <= 0 else min(20, int((processed_pages / max(total_pages, 1)) * 20))
            job.progress = preload_progress

        media_items = await media_service.fetch_all_media_library_items(
            wp_url=wp_url,
            wp_user=wp_user,
            wp_app_password=wp_app_password,
            db=job_db,
            tenant_id=tenant_id,
            on_progress=on_media_progress,
        )
        job.stage = "indexing"
        job.current_identifier = "Biblioteca de imágenes lista"
        job.current_product_name = f"Se cargaron {len(media_items)} imágenes para esta importación"
        job.progress = 20
        media_lookup = media_service.build_media_lookup(media_items)
        media_resolution_cache: dict[str, dict] = {}

        async def resolve_media_names(names: list[str]) -> list[dict]:
            resolved: list[dict] = []
            missing_names = [name for name in names if name not in media_resolution_cache]
            if missing_names:
                fetched = media_service.resolve_media_names_from_items(
                    names=missing_names,
                    items=media_items,
                    media_lookup=media_lookup,
                )
                for entry in fetched:
                    media_resolution_cache[entry["requested"]] = entry
            for name in names:
                cached_entry = media_resolution_cache.get(name)
                if cached_entry is not None:
                    resolved.append(cached_entry)
            return resolved

        selected_indexes = set(range(len(rows))) if selected_row_indexes is None else set(selected_row_indexes)
        products_by_id = {int(product["id"]): product for product in products if str(product.get("id", "")).isdigit()}
        products_by_sku = {str(product.get("sku", "")): product for product in products if product.get("sku")}
        matched_rows = []
        for row_index, row in enumerate(rows):
            if row_index not in selected_indexes:
                continue
            sku = row.get("sku", "").strip()
            product_id = row.get("product_id", "").strip()
            product = None
            identifier = sku or product_id or "sin identificador"
            if sku:
                product = products_by_sku.get(sku)
            elif product_id.isdigit():
                product = products_by_id.get(int(product_id))
            if product is not None:
                matched_rows.append(
                    ImportImagesJobRowStatus(
                        row_index=row_index,
                        identifier=identifier,
                        product_id=int(product["id"]) if product.get("id") is not None else None,
                        product_name=str(product.get("name") or "") or None,
                    )
                )
        job.rows = matched_rows
        total_selected = max(len(matched_rows), 1)

        async def on_prepare_progress(*, stage: str, row_index: int, identifier: str, product: str | None = None, error: str | None = None):
            row_status = next((item for item in job.rows if item.row_index == row_index), None)
            if row_status is None:
                return
            ordinal = next((index for index, item in enumerate(job.rows, start=1) if item.row_index == row_index), 0)
            if stage == "preparing":
                job.stage = "preparing"
                row_status.status = "running"
                row_status.error = None
                job.current_identifier = f"Preparando {ordinal} de {len(job.rows)}"
                job.current_product_name = product or identifier
                job.progress = min(60, 20 + int(ordinal * 40 / total_selected))
            elif stage == "prepared":
                job.stage = "preparing"
                row_status.status = "pending"
                job.prepared = max(job.prepared, ordinal)
                job.current_identifier = f"Fila preparada {ordinal} de {len(job.rows)}"
                job.current_product_name = product or identifier
                job.progress = min(60, 20 + int(ordinal * 40 / total_selected))
            elif stage == "failed":
                job.stage = "preparing"
                row_status.status = "failed"
                row_status.error = error
                job.current_identifier = f"Falló preparación {ordinal} de {len(job.rows)}"
                job.current_product_name = product or identifier

        payloads, preparation_errors, selected_rows = await excel_service.prepare_bulk_update_payloads(
            rows=rows,
            selected_fields=["images"],
            products=products,
            resolve_media_names=resolve_media_names,
            selected_row_indexes=selected_row_indexes,
            on_row_progress=on_prepare_progress,
        )
        result.failed += len(preparation_errors)
        result.errors.extend(preparation_errors)
        result.total_rows = len(selected_rows)
        job.total = len(payloads)

        for index, payload in enumerate(payloads, start=1):
            identifier = str(payload.pop("_identifier", payload.get("id", "sin identificador")))
            row_index = int(payload.pop("_row_index", index - 1))
            product_name = payload.pop("_product_name", None)
            product_id = int(payload.get("id")) if payload.get("id") is not None else None

            row_status = next((item for item in job.rows if item.row_index == row_index), None)
            if row_status is None:
                row_status = ImportImagesJobRowStatus(
                    row_index=row_index,
                    identifier=identifier,
                    product_id=product_id,
                    product_name=product_name,
                )
                job.rows.append(row_status)

            row_status.status = "running"
            job.stage = "updating"
            job.current_identifier = f"Actualizando {index} de {len(payloads)}"
            job.current_product_name = product_name or identifier
            job.progress = 60 + int((max(index - 1, 0) * 40) / max(len(payloads), 1))

            try:
                updated_product = await woo_service.update_product(int(payload["id"]), payload)
                updated_products.append(updated_product)
                result.updated += 1
                row_status.status = "completed"
            except Exception as exc:
                row_status.status = "failed"
                row_status.error = str(exc)
                result.failed += 1
                result.errors.append({"identifier": identifier, "error": str(exc)})

            job.processed = index
            job.progress = 60 + int(index * 40 / max(len(payloads), 1))

        if updated_products:
            backup_record = backup_repository.get_backup_for_tenant(job_db, tenant_id, backup_id)
            if backup_record is not None:
                backup_service.merge_products_into_backup(job_db, backup_record, updated_products)
                job_db.commit()

        job.result = result
        job.status = "completed"
        job.stage = "completed"
        job.progress = 100
        job.current_identifier = None
        job.current_product_name = None
    except Exception as exc:
        job.status = "failed"
        job.stage = "failed"
        job.error = str(exc)
    finally:
        if job_db is not None:
            job_db.close()


async def get_import_apply_job_status(*, job_id: str):
    job = import_apply_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import job not found")
    return job.model_dump()


async def apply_import_draft(
    *,
    db: Session,
    tenant_id: UUID,
    selected_fields: list[str],
    selected_row_indexes: list[int] | None,
    products: list[dict],
    backup_record,
    woo_service,
    credentials: dict[str, str],
    wp_url: str | None = None,
    wp_user: str | None = None,
    wp_app_password: str | None = None,
):
    _, file_bytes = get_current_import_draft_bytes(db, tenant_id)
    headers, rows = excel_service.parse_excel(file_bytes)
    excel_service.validate_selected_fields(headers, selected_fields)
    non_image_fields = [field for field in selected_fields if field != "images"]
    image_fields = ["images"] if "images" in selected_fields else []

    response_summary = ImportApplyResult(total_rows=len(selected_row_indexes or rows))
    updated_products_for_backup: list[dict] = []

    if non_image_fields:
        summary, updated_products = await excel_service.build_bulk_update_summary(
            rows=rows,
            selected_fields=non_image_fields,
            products=products,
            woo_service=woo_service,
            selected_row_indexes=selected_row_indexes,
        )
        response_summary.updated += summary.updated
        response_summary.failed += summary.failed
        response_summary.errors.extend(summary.errors)
        response_summary.total_rows = max(response_summary.total_rows, summary.total_rows)
        updated_products_for_backup.extend(updated_products)

    if updated_products_for_backup:
        from services import backup as backup_service

        backup_service.merge_products_into_backup(db, backup_record, updated_products_for_backup)
        db.commit()

    if not image_fields:
        return response_summary.model_dump()

    if not wp_url or not wp_user or not wp_app_password:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este cliente no tiene credenciales de WordPress para resolver nombres de imagen")

    job_id = str(uuid.uuid4())
    import_apply_jobs[job_id] = ImportImagesJobStatus(
        job_id=job_id,
        status="pending",
        current_identifier="En cola",
        current_product_name="Esperando inicio del proceso de imágenes",
    )
    asyncio.create_task(
        _run_import_images_job(
            job_id=job_id,
            tenant_id=backup_record.tenant_id,
            backup_id=backup_record.id,
            rows=rows,
            selected_row_indexes=selected_row_indexes,
            products=products,
            credentials=credentials,
            wp_url=wp_url,
            wp_user=wp_user,
            wp_app_password=wp_app_password,
        )
    )
    return {
        **response_summary.model_dump(),
        "images_job": {"job_id": job_id},
    }


def delete_import_draft(db: Session, tenant_id: UUID) -> None:
    record = import_draft_repository.get_import_draft_for_tenant(db, tenant_id)
    if record is None:
        return
    _remove_file(record.storage_path)
    import_draft_repository.delete_import_draft(db, record)
    db.commit()
