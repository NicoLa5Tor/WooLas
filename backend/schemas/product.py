from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ProductImageInput(BaseModel):
    id: int | None = None
    src: str | None = None


class ProductBase(BaseModel):
    name: str
    sku: str | None = None
    regular_price: str | None = None
    sale_price: str | None = None
    stock_quantity: int | None = None
    short_description: str | None = None
    description: str | None = None
    status: Literal["publish", "draft"] = "publish"
    manage_stock: bool | None = None
    stock_status: Literal["instock", "outofstock", "onbackorder"] | None = None
    weight: str | None = None
    type: Literal["simple"] = "simple"
    categories: list[int] = Field(default_factory=list)
    images: list[ProductImageInput] = Field(default_factory=list)
    dimensions: dict[str, str] | None = None


class ProductCreate(ProductBase):
    name: str


class ProductUpdate(BaseModel):
    name: str | None = None
    sku: str | None = None
    regular_price: str | None = None
    sale_price: str | None = None
    stock_quantity: int | None = None
    short_description: str | None = None
    description: str | None = None
    status: Literal["publish", "draft"] | None = None
    manage_stock: bool | None = None
    stock_status: Literal["instock", "outofstock", "onbackorder"] | None = None
    weight: str | None = None
    categories: list[int] | None = None
    images: list[ProductImageInput] | None = None
    dimensions: dict[str, str] | None = None


class PreviewRow(BaseModel):
    identifier: str
    current_value: Any = None
    new_value: Any = None
    product_found: bool
    product_id: int | None = None
    product_name: str | None = None


class UpdateSummary(BaseModel):
    updated: int
    failed: int
    errors: list[dict[str, str]]
    total_rows: int
