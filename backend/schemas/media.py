from datetime import datetime

from pydantic import BaseModel


class MediaItem(BaseModel):
    id: int
    url: str
    thumbnail: str
    filename: str
    uploaded_at: datetime


class MediaListResponse(BaseModel):
    items: list[MediaItem]
    page: int
    total_pages: int
    total: int
