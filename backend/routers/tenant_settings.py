from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from core.dependencies import TenantAccessContext, require_role
from core.responses import success_response
from models.user import Role
from services import tenant_settings as settings_service
from services.woocommerce import WooCommerceService


router = APIRouter(prefix="/api/tenants/{tenant_id}/settings", tags=["settings"])


class UpdateSettingPayload(BaseModel):
    value: Any


@router.get("")
async def get_tenant_settings(
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    woo = WooCommerceService(**context.credentials)
    try:
        sections = await settings_service.get_all_settings(woo)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Error consultando WC: {exc}")
    return success_response({"sections": sections})


@router.put("/{section_key}/{field_key}")
async def update_tenant_setting(
    section_key: str,
    field_key: str,
    payload: UpdateSettingPayload,
    context: TenantAccessContext = Depends(require_role(Role.CLIENT)),
):
    woo = WooCommerceService(**context.credentials)
    try:
        result = await settings_service.update_setting(woo, section_key, field_key, payload.value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"WC rechazó update: {exc}")
    return success_response(result)
