from datetime import datetime, timedelta
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from sqlalchemy.orm import Session

from repositories import media_cache as media_cache_repository
from schemas.media import MediaItem


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
    return PurePosixPath(candidate).name or f"media-{item.get('id', 'unknown')}"


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
        uploaded_at=uploaded_at,
    ).model_dump(mode="json")


def _cache_key(page: int, search: str | None) -> str:
    return f"page:{page}|search:{(search or '').strip().lower()}"


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
    db.commit()
    return _serialize_media(payload)
