from datetime import datetime

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
