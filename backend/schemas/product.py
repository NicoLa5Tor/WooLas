from typing import Any, Literal

from pydantic import BaseModel, Field


ProductType = Literal["simple", "variable", "grouped", "external"]
ProductStatus = Literal["publish", "draft", "pending", "private"]
CatalogVisibility = Literal["visible", "catalog", "search", "hidden"]
StockStatus = Literal["instock", "outofstock", "onbackorder"]
BackordersStatus = Literal["no", "notify", "yes"]


class ProductImageInput(BaseModel):
    id: int | None = None
    src: str | None = None
    name: str | None = None
    alt: str | None = None


class ProductTaxonomyRef(BaseModel):
    id: int


class ProductDimensionsInput(BaseModel):
    length: str | None = None
    width: str | None = None
    height: str | None = None


class ProductAttributeInput(BaseModel):
    id: int | None = None
    name: str | None = None
    position: int = 0
    visible: bool = True
    variation: bool = False
    options: list[str] = Field(default_factory=list)


class ProductDownloadInput(BaseModel):
    name: str
    file: str


class ProductMetaDataInput(BaseModel):
    key: str
    value: Any = None


class VariationAttributeInput(BaseModel):
    id: int | None = None
    option: str


class ProductVariationBase(BaseModel):
    regular_price: str | None = None
    sale_price: str | None = None
    stock_quantity: int | None = None
    manage_stock: bool | None = None
    stock_status: StockStatus | None = None
    weight: str | None = None
    dimensions: ProductDimensionsInput | None = None
    sku: str | None = None
    image: ProductTaxonomyRef | None = None
    attributes: list[VariationAttributeInput] = Field(default_factory=list)
    virtual: bool | None = None
    downloadable: bool | None = None
    downloads: list[ProductDownloadInput] = Field(default_factory=list)
    download_limit: int | None = None
    download_expiry: int | None = None
    meta_data: list[ProductMetaDataInput] = Field(default_factory=list)


class ProductVariationCreate(ProductVariationBase):
    pass


class ProductVariationUpdate(ProductVariationBase):
    pass


class AssignImagesBySkuStartResponse(BaseModel):
    job_id: str


class AssignImagesBySkuResult(BaseModel):
    products_updated: int = 0
    skus_not_found: list[str] = Field(default_factory=list)
    errors: list[dict[str, str]] = Field(default_factory=list)


class AssignImagesBySkuStatus(BaseModel):
    job_id: str
    status: Literal["pending", "running", "completed", "failed"]
    progress: int = 0
    processed: int = 0
    total: int = 0
    result: AssignImagesBySkuResult | None = None
    error: str | None = None


class ProductBase(BaseModel):
    name: str
    slug: str | None = None
    sku: str | None = None
    type: ProductType = "simple"
    status: ProductStatus = "publish"
    featured: bool | None = None
    catalog_visibility: CatalogVisibility | None = None
    regular_price: str | None = None
    sale_price: str | None = None
    date_on_sale_from: str | None = None
    date_on_sale_to: str | None = None
    description: str | None = None
    short_description: str | None = None
    manage_stock: bool | None = None
    stock_quantity: int | None = None
    stock_status: StockStatus | None = None
    backorders: BackordersStatus | None = None
    sold_individually: bool | None = None
    low_stock_amount: int | None = None
    weight: str | None = None
    dimensions: ProductDimensionsInput | None = None
    shipping_class: str | None = None
    virtual: bool | None = None
    downloadable: bool | None = None
    images: list[ProductImageInput] = Field(default_factory=list)
    categories: list[ProductTaxonomyRef] = Field(default_factory=list)
    tags: list[ProductTaxonomyRef] = Field(default_factory=list)
    attributes: list[ProductAttributeInput] = Field(default_factory=list)
    upsell_ids: list[int] = Field(default_factory=list)
    cross_sell_ids: list[int] = Field(default_factory=list)
    downloads: list[ProductDownloadInput] = Field(default_factory=list)
    download_limit: int | None = None
    download_expiry: int | None = None
    meta_data: list[ProductMetaDataInput] = Field(default_factory=list)


class ProductCreate(ProductBase):
    name: str


class ProductUpdate(ProductBase):
    name: str | None = None
    type: ProductType | None = None
    status: ProductStatus | None = None
    catalog_visibility: CatalogVisibility | None = None
    stock_status: StockStatus | None = None
    backorders: BackordersStatus | None = None
    sku: str | None = None
    categories: list[ProductTaxonomyRef] | None = None
    tags: list[ProductTaxonomyRef] | None = None
    images: list[ProductImageInput] | None = None
    attributes: list[ProductAttributeInput] | None = None
    upsell_ids: list[int] | None = None
    cross_sell_ids: list[int] | None = None
    downloads: list[ProductDownloadInput] | None = None
    meta_data: list[ProductMetaDataInput] | None = None


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
