from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MediaItem(BaseModel):
    id: int
    url: str
    thumbnail: str
    filename: str
    title: str | None = None
    slug: str | None = None
    uploaded_at: datetime


class MediaListResponse(BaseModel):
    items: list[MediaItem]
    page: int
    total_pages: int
    total: int


class MediaResolvePayload(BaseModel):
    names: list[str] = Field(default_factory=list)


class MediaResolveResult(BaseModel):
    requested: str
    matched: bool
    item: MediaItem | None = None


class MediaSyncJobStatus(BaseModel):
    job_id: str
    status: Literal["pending", "running", "completed", "failed"]
    processed_pages: int = 0
    total_pages: int = 0
    total_items: int = 0
    from_cache: bool = False
    progress: int = 0
    error: str | None = None
