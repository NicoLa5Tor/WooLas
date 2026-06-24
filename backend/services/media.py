import asyncio
import html
from datetime import datetime, timedelta
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import unquote, urlsplit, urlunsplit
import re
import unicodedata

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from repositories import media_cache as media_cache_repository
from repositories import media_index as media_index_repository
from schemas.media import MediaItem, MediaPurgeJobStatus, MediaSyncJobStatus


def _base_wp_url(wc_url: str) -> str:
    marker = "/wp-json/wc/"
    if marker in wc_url:
        return wc_url.split(marker, 1)[0].rstrip("/")

    parsed = urlsplit(wc_url)
    path = parsed.path.rstrip("/")
    if path.endswith("/wp-json"):
        path = path[: -len("/wp-json")]
    return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment)).rstrip("/")


def _filename_from_media(item: dict[str, Any]) -> str:
    source = item.get("source_url") or ""
    media_file = item.get("media_details", {}).get("file") or ""
    candidate = media_file or source
    return unquote(PurePosixPath(candidate).name) or f"media-{item.get('id', 'unknown')}"


def _serialize_media(item: dict[str, Any]) -> dict[str, Any]:
    sizes = item.get("media_details", {}).get("sizes", {})
    thumbnail = sizes.get("thumbnail", {}).get("source_url") or sizes.get("medium", {}).get("source_url") or item.get("source_url") or ""
    uploaded_at_raw = item.get("date_gmt") or item.get("date")
    uploaded_at = datetime.fromisoformat(uploaded_at_raw.replace("Z", "+00:00")) if uploaded_at_raw else datetime.utcnow()

    return MediaItem(
        id=int(item["id"]),
        url=item.get("source_url") or "",
        thumbnail=thumbnail,
        filename=_filename_from_media(item),
        title=((item.get("title") or {}).get("rendered") or None),
        slug=item.get("slug") or None,
        uploaded_at=uploaded_at,
    ).model_dump(mode="json")


def _coerce_uploaded_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if text:
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.utcnow()


def _cache_key(page: int, search: str | None) -> str:
    return f"page:{page}|search:{(search or '').strip().lower()}"


def _full_library_cache_key() -> str:
    return "all-pages|search:"


async def get_media_library(
    db: Session,
    tenant_id,
    wp_url: str,
    wp_user: str,
    wp_app_password: str,
    page: int,
    search: str | None,
    cache_ttl_minutes: int,
):
    cache_key = _cache_key(page, search)
    record = media_cache_repository.get_media_cache_record(db, tenant_id, cache_key)
    if record and record.created_at + timedelta(minutes=cache_ttl_minutes) >= datetime.utcnow():
        return {
            "items": record.payload,
            "page": record.page,
            "total_pages": record.total_pages,
            "total": record.total,
            "cached": True,
        }

    endpoint = f"{_base_wp_url(wp_url)}/wp-json/wp/v2/media"
    params: dict[str, Any] = {"media_type": "image", "per_page": 50, "page": page}
    if search:
        params["search"] = search

    async with httpx.AsyncClient(timeout=60.0, auth=httpx.BasicAuth(wp_user, wp_app_password)) as client:
        response = await client.get(endpoint, params=params)
        response.raise_for_status()
        payload = response.json()

    items = [_serialize_media(item) for item in payload]
    total_pages = int(response.headers.get("X-WP-TotalPages", 1))
    total = int(response.headers.get("X-WP-Total", len(payload)))

    media_cache_repository.upsert_media_cache_record(
        db,
        tenant_id=tenant_id,
        cache_key=cache_key,
        page=page,
        total_pages=total_pages,
        total=total,
        payload=items,
    )
    sync_media_index_records(db, tenant_id, items, remove_missing=False)
    db.commit()

    return {
        "items": items,
        "page": page,
        "total_pages": total_pages,
        "total": total,
        "cached": False,
    }


async def upload_media(db: Session, tenant_id, wp_url: str, wp_user: str, wp_app_password: str, file_bytes: bytes, filename: str, content_type: str):
    endpoint = f"{_base_wp_url(wp_url)}/wp-json/wp/v2/media"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type": content_type,
    }

    async with httpx.AsyncClient(timeout=120.0, auth=httpx.BasicAuth(wp_user, wp_app_password)) as client:
        response = await client.post(endpoint, headers=headers, content=file_bytes)
        response.raise_for_status()
        payload = response.json()

    media_cache_repository.delete_media_cache_for_tenant(db, tenant_id)
    item = _serialize_media(payload)
    sync_media_index_records(db, tenant_id, [item], remove_missing=False)
    db.commit()
    return item


async def fetch_all_media_library_items(
    *,
    wp_url: str,
    wp_user: str,
    wp_app_password: str,
    db: Session | None = None,
    tenant_id=None,
    cache_ttl_minutes: int = 60,
    on_progress=None,
) -> list[dict[str, Any]]:
    endpoint = f"{_base_wp_url(wp_url)}/wp-json/wp/v2/media"
    if db is not None and tenant_id is not None:
        full_cache = media_cache_repository.get_media_cache_record(db, tenant_id, _full_library_cache_key())
        if full_cache and full_cache.created_at + timedelta(minutes=cache_ttl_minutes) >= datetime.utcnow():
            if on_progress is not None:
                await on_progress(processed_pages=full_cache.total_pages, total_pages=full_cache.total_pages, from_cache=True)
            return list(full_cache.payload or [])

    items: list[dict[str, Any]] = []
    all_media_ids: set[int] = set()
    total_pages = 1

    async with httpx.AsyncClient(timeout=120.0, auth=httpx.BasicAuth(wp_user, wp_app_password)) as client:
        for page in range(1, 10_000):
            response = await client.get(endpoint, params={"media_type": "image", "per_page": 100, "page": page})
            response.raise_for_status()
            page_items = [_serialize_media(item) for item in response.json()]
            if not page_items:
                break
            total_pages = int(response.headers.get("X-WP-TotalPages", page))
            items.extend(page_items)
            for item in page_items:
                if item.get("id"):
                    all_media_ids.add(int(item["id"]))

            # Commit each page incrementally — if sync fails mid-way, pages already saved
            if db is not None and tenant_id is not None:
                sync_media_index_records(db, tenant_id, page_items, remove_missing=False)
                db.commit()

            if on_progress is not None:
                await on_progress(processed_pages=page, total_pages=total_pages, from_cache=False)

            if page >= total_pages:
                break

    if db is not None and tenant_id is not None:
        # Remove stale entries only after all pages collected
        media_index_repository.delete_missing_media_index_records(db, tenant_id, all_media_ids)
        media_cache_repository.upsert_media_cache_record(
            db,
            tenant_id=tenant_id,
            cache_key=_full_library_cache_key(),
            page=1,
            total_pages=max(1, total_pages),
            total=len(items),
            payload=items,
        )
        db.commit()

    return items


media_sync_jobs: dict[str, MediaSyncJobStatus] = {}


async def _run_media_sync_job(
    *,
    job_id: str,
    tenant_id,
    wp_url: str,
    wp_user: str,
    wp_app_password: str,
) -> None:
    from core.database import SessionLocal

    job = media_sync_jobs[job_id]
    db = None
    try:
        job.status = "running"
        db = SessionLocal()

        async def on_progress(*, processed_pages: int, total_pages: int, from_cache: bool) -> None:
            job.processed_pages = processed_pages
            job.total_pages = max(total_pages, 1)
            job.from_cache = from_cache
            job.progress = min(95, int(processed_pages * 95 / max(total_pages, 1)))

        # cache_ttl_minutes=0 → ignora caché, siempre descarga fresco de WP
        items = await fetch_all_media_library_items(
            wp_url=wp_url,
            wp_user=wp_user,
            wp_app_password=wp_app_password,
            db=db,
            tenant_id=tenant_id,
            cache_ttl_minutes=0,
            on_progress=on_progress,
        )
        job.total_items = len(items)
        job.progress = 100
        job.status = "completed"
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
    finally:
        if db is not None:
            db.close()


def start_media_sync(*, tenant_id, wp_url: str, wp_user: str, wp_app_password: str) -> MediaSyncJobStatus:
    import uuid
    job_id = str(uuid.uuid4())
    job = MediaSyncJobStatus(job_id=job_id, status="pending")
    media_sync_jobs[job_id] = job
    asyncio.create_task(
        _run_media_sync_job(
            job_id=job_id,
            tenant_id=tenant_id,
            wp_url=wp_url,
            wp_user=wp_user,
            wp_app_password=wp_app_password,
        )
    )
    return job


def get_media_sync_job(job_id: str) -> MediaSyncJobStatus | None:
    return media_sync_jobs.get(job_id)


def sync_media_index_records(db: Session, tenant_id, items: list[dict[str, Any]], *, remove_missing: bool = True) -> list[dict[str, Any]]:
    keep_media_ids: set[int] = set()
    indexed_items: list[dict[str, Any]] = []
    for item in items:
        media_id = item.get("id")
        if media_id is None:
            continue
        keep_media_ids.add(int(media_id))
        lookup_values = list(dict.fromkeys(_item_lookup_values(item)))
        record = media_index_repository.upsert_media_index_record(
            db,
            tenant_id=tenant_id,
            media_id=int(media_id),
            url=str(item.get("url") or ""),
            thumbnail=str(item.get("thumbnail") or ""),
            filename=str(item.get("filename") or ""),
            title=None if item.get("title") in {None, ""} else str(item.get("title")),
            slug=None if item.get("slug") in {None, ""} else str(item.get("slug")),
            lookup_values=lookup_values,
            uploaded_at=_coerce_uploaded_at(item.get("uploaded_at")),
        )
        indexed_items.append(_serialize_index_record(record))

    if remove_missing:
        media_index_repository.delete_missing_media_index_records(db, tenant_id, keep_media_ids)
    return indexed_items


def get_media_library_from_index(
    db: Session,
    tenant_id,
    *,
    page: int = 1,
    per_page: int = 50,
    search: str | None = None,
) -> dict[str, Any]:
    items, total = media_index_repository.list_media_index_records_paginated(
        db, tenant_id, page=page, per_page=per_page, search=search
    )
    total_pages = max(1, (total + per_page - 1) // per_page)
    return {
        "items": [_serialize_index_record(r) for r in items],
        "page": page,
        "total_pages": total_pages,
        "total": total,
        "from_index": True,
    }


def get_media_index_count(db: Session, tenant_id) -> int:
    return media_index_repository.count_media_index_records(db, tenant_id)


MEDIA_INDEX_MAX_AGE_HOURS = 2


def get_media_index_last_synced(db: Session, tenant_id) -> datetime | None:
    record = media_cache_repository.get_media_cache_record(db, tenant_id, _full_library_cache_key())
    return record.created_at if record else None


def require_fresh_media_index(db: Session, tenant_id) -> None:
    last_synced = get_media_index_last_synced(db, tenant_id)
    if last_synced is None:
        raise HTTPException(
            status_code=409,
            detail="El índice de imágenes no ha sido sincronizado. Ve a Imágenes y pulsa 'Sincronizar índice' antes de continuar.",
        )
    if last_synced + timedelta(hours=MEDIA_INDEX_MAX_AGE_HOURS) < datetime.utcnow():
        raise HTTPException(
            status_code=409,
            detail=f"El índice de imágenes tiene más de {MEDIA_INDEX_MAX_AGE_HOURS} horas. Ve a Imágenes y vuelve a sincronizar.",
        )


def list_media_index_items(db: Session, tenant_id) -> list[dict[str, Any]]:
    return [_serialize_index_record(record) for record in media_index_repository.list_media_index_records(db, tenant_id)]


def resolve_media_by_names_from_index(*, db: Session, tenant_id, names: list[str]) -> list[dict[str, Any]]:
    items = list_media_index_items(db, tenant_id)
    by_filename = _build_media_lookup(items)
    resolved: list[dict[str, Any]] = []
    for name in names:
        item = _find_media_in_items(name, items=items, by_lookup=by_filename)
        resolved.append({"requested": name, "matched": item is not None, "item": item})
    return resolved


def resolve_media_names_from_items(*, names: list[str], items: list[dict[str, Any]], media_lookup: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    by_filename = media_lookup if media_lookup is not None else _build_media_lookup(items)
    resolved: list[dict[str, Any]] = []
    for name in names:
        item = _find_media_in_items(name, items=items, by_lookup=by_filename)
        resolved.append({"requested": name, "matched": item is not None, "item": item})
    return resolved


async def resolve_media_by_names_targeted(
    *,
    wp_url: str,
    wp_user: str,
    wp_app_password: str,
    names: list[str],
) -> list[dict[str, Any]]:
    """Per-name WP search only — no full library fetch. Used as fallback after index miss."""
    resolved: list[dict[str, Any]] = []
    for name in names:
        full_name, stem = _normalize_media_lookup(name)
        if not full_name and not stem:
            resolved.append({"requested": name, "matched": False, "item": None})
            continue
        payload = await _search_media_items(
            wp_url=wp_url, wp_user=wp_user, wp_app_password=wp_app_password, search=name
        )
        serialized = [_serialize_media(c) for c in payload]
        lookup = _build_media_lookup(serialized)
        # _find_media_in_items handles exact match + substring fallback in both directions
        item = _find_media_in_items(name, items=serialized, by_lookup=lookup)
        resolved.append({"requested": name, "matched": item is not None, "item": item})
    return resolved


async def _search_media_items(*, wp_url: str, wp_user: str, wp_app_password: str, search: str) -> list[dict[str, Any]]:
    endpoint = f"{_base_wp_url(wp_url)}/wp-json/wp/v2/media"
    async with httpx.AsyncClient(timeout=60.0, auth=httpx.BasicAuth(wp_user, wp_app_password)) as client:
        response = await client.get(endpoint, params={"media_type": "image", "per_page": 100, "search": search})
        response.raise_for_status()
        return response.json()


def _build_media_lookup(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_filename: dict[str, dict[str, Any]] = {}
    for item in items:
        for lookup_value in _item_lookup_values(item):
            by_filename.setdefault(lookup_value, item)
    return by_filename


def build_media_lookup(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return _build_media_lookup(items)


def _serialize_index_record(record) -> dict[str, Any]:
    return MediaItem(
        id=int(record.media_id),
        url=record.url or "",
        thumbnail=record.thumbnail or "",
        filename=record.filename or "",
        title=record.title,
        slug=record.slug,
        uploaded_at=record.uploaded_at,
    ).model_dump(mode="json")


def _find_media_in_items(name: str, *, items: list[dict[str, Any]], by_lookup: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    full_name, stem = _normalize_media_lookup(name)
    if not full_name and not stem:
        return None

    direct_match = by_lookup.get(full_name) or by_lookup.get(stem)
    if direct_match is not None:
        return direct_match

    # Fallback local: si el usuario manda una referencia incompleta, buscamos por coincidencia
    # dentro de filename/title/slug/url sin volver a consultar WordPress.
    probe_values = tuple(value for value in {full_name, stem} if value)
    for item in items:
        values = _item_lookup_values(item)
        if any(probe in candidate or candidate in probe for probe in probe_values for candidate in values):
            return item
    return None


def _normalize_media_lookup(value: str) -> tuple[str, str]:
    cleaned = html.unescape(str(value)).strip().lower()
    cleaned = unquote(cleaned)
    if not cleaned:
        return "", ""
    cleaned = unicodedata.normalize("NFKD", cleaned)
    cleaned = "".join(char for char in cleaned if not unicodedata.combining(char))
    cleaned = re.sub(r"[^\w\s.-]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    # Normalize spaces → dashes so "nombre con espacios.jpg" matches "nombre-con-espacios.jpg" (WP slug style)
    cleaned = cleaned.replace(" ", "-")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    stem, dot, extension = cleaned.rpartition(".")
    if dot and extension in {"jpg", "jpeg", "png", "webp", "gif"}:
        return cleaned, stem
    return cleaned, cleaned


def _item_lookup_values(item: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for raw_value in (
        item.get("filename"),
        item.get("title"),
        item.get("slug"),
        PurePosixPath(unquote(str(item.get("url") or ""))).name,
    ):
        cleaned = str(raw_value or "").strip()
        if not cleaned:
            continue
        full_name, stem = _normalize_media_lookup(cleaned)
        if full_name:
            values.append(full_name)
        if stem:
            values.append(stem)
    return values


async def resolve_media_by_names(
    *,
    wp_url: str,
    wp_user: str,
    wp_app_password: str,
    names: list[str],
    media_items: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    items = media_items if media_items is not None else await fetch_all_media_library_items(wp_url=wp_url, wp_user=wp_user, wp_app_password=wp_app_password)
    by_filename = _build_media_lookup(items)

    resolved: list[dict[str, Any]] = []
    for name in names:
        item = _find_media_in_items(name, items=items, by_lookup=by_filename)
        if item is None and media_items is None:
            full_name, stem = _normalize_media_lookup(name)
            payload = await _search_media_items(wp_url=wp_url, wp_user=wp_user, wp_app_password=wp_app_password, search=name)
            for candidate in payload:
                candidate_item = _serialize_media(candidate)
                candidate_values = _item_lookup_values(candidate_item)
                if full_name in candidate_values or stem in candidate_values:
                    item = candidate_item
                    break
        resolved.append(
            {
                "requested": name,
                "matched": item is not None,
                "item": item,
            }
        )

    return resolved


media_purge_jobs: dict[str, MediaPurgeJobStatus] = {}


async def _run_media_purge_job(
    *,
    job_id: str,
    tenant_id,
    wp_url: str,
    wp_user: str,
    wp_app_password: str,
) -> None:
    from core.database import SessionLocal

    job = media_purge_jobs[job_id]
    db = None
    try:
        job.status = "running"
        db = SessionLocal()

        # Fetch every media item from WP fresh (cache_ttl_minutes=0)
        items = await fetch_all_media_library_items(
            wp_url=wp_url,
            wp_user=wp_user,
            wp_app_password=wp_app_password,
            db=db,
            tenant_id=tenant_id,
            cache_ttl_minutes=0,
        )
        job.total = len(items)

        base = f"{_base_wp_url(wp_url)}/wp-json/wp/v2/media"
        async with httpx.AsyncClient(timeout=60.0, auth=httpx.BasicAuth(wp_user, wp_app_password)) as client:
            for item in items:
                media_id = item.get("id")
                if not media_id:
                    job.processed += 1
                    continue
                job.current_filename = str(item.get("filename") or f"media-{media_id}")
                try:
                    response = await client.delete(f"{base}/{media_id}", params={"force": "true"})
                    response.raise_for_status()
                    job.deleted += 1
                    media_index_repository.delete_media_index_record_by_media_id(db, tenant_id, int(media_id))
                except Exception as exc:
                    job.failed += 1
                    job.errors.append({"media_id": str(media_id), "error": str(exc)[:200]})
                finally:
                    job.processed += 1
                    job.progress = min(99, int(job.processed * 100 / max(job.total, 1)))

        # Clean cache + remaining records
        media_cache_repository.delete_media_cache_for_tenant(db, tenant_id)
        if job.failed == 0:
            media_index_repository.delete_all_media_index_records(db, tenant_id)
        db.commit()
        job.current_filename = None
        job.progress = 100
        job.status = "completed"
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
    finally:
        if db is not None:
            db.close()


def start_media_purge(*, tenant_id, wp_url: str, wp_user: str, wp_app_password: str) -> MediaPurgeJobStatus:
    import uuid
    job_id = str(uuid.uuid4())
    job = MediaPurgeJobStatus(job_id=job_id, status="pending")
    media_purge_jobs[job_id] = job
    asyncio.create_task(
        _run_media_purge_job(
            job_id=job_id,
            tenant_id=tenant_id,
            wp_url=wp_url,
            wp_user=wp_user,
            wp_app_password=wp_app_password,
        )
    )
    return job


def get_media_purge_job(job_id: str) -> MediaPurgeJobStatus | None:
    return media_purge_jobs.get(job_id)
