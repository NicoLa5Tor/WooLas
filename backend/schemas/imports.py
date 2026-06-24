from typing import Literal

from pydantic import BaseModel, Field


class ImportHeaderSuggestion(BaseModel):
    provided: str
    expected: str
    confidence: float


class ImportExpectedField(BaseModel):
    key: str
    label: str
    required: bool


class ImportFormatAnalysis(BaseModel):
    status: Literal["ready", "typos", "refactor_required"]
    source_headers: list[str] = Field(default_factory=list)
    normalized_headers: list[str] = Field(default_factory=list)
    typo_suggestions: list[ImportHeaderSuggestion] = Field(default_factory=list)
    missing_required: list[str] = Field(default_factory=list)
    unknown_headers: list[str] = Field(default_factory=list)
    expected_fields: list[ImportExpectedField] = Field(default_factory=list)


class ImportRefactorPayload(BaseModel):
    mapping: dict[str, str | None]


class ImportApplyResult(BaseModel):
    updated: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list[dict[str, str]] = Field(default_factory=list)
    total_rows: int = 0


class ImportImagesJobRowStatus(BaseModel):
    row_index: int
    identifier: str
    product_id: int | None = None
    product_name: str | None = None
    status: Literal["pending", "running", "completed", "failed", "skipped"] = "pending"
    error: str | None = None
    # Detalle por fila: qué se pidió, qué resolvió, qué aplicó WC.
    requested_principal_id: int | None = None
    requested_gallery_ids: list[int] = Field(default_factory=list)
    requested_names: list[str] = Field(default_factory=list)
    resolved_image_ids: list[int] = Field(default_factory=list)
    resolved_image_names: list[str] = Field(default_factory=list)
    unresolved_names: list[str] = Field(default_factory=list)
    applied_image_ids: list[int] = Field(default_factory=list)


class ImportImagesJobStatus(BaseModel):
    job_id: str
    status: Literal["pending", "running", "completed", "failed"]
    stage: Literal["pending", "preparing", "updating", "completed", "failed"] = "pending"
    progress: int = 0
    prepared: int = 0
    processed: int = 0
    total: int = 0
    current_identifier: str | None = None
    current_product_name: str | None = None
    rows: list[ImportImagesJobRowStatus] = Field(default_factory=list)
    result: ImportApplyResult | None = None
    error: str | None = None
