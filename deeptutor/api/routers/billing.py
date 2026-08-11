"""Phase-A membership and voucher redemption API."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from deeptutor.api.routers.auth import require_admin, require_auth
from deeptutor.multi_user.context import get_current_user
from deeptutor.services import billing

router = APIRouter()


class RedeemRequest(BaseModel):
    code: str = Field(min_length=1, max_length=256)
    request_id: str | None = Field(default=None, max_length=128)


class VoucherImportRequest(BaseModel):
    plan_code: str = Field(min_length=1, max_length=64)
    codes: list[str] = Field(min_length=1, max_length=500)
    batch_id: str | None = Field(default=None, max_length=128)


class VoucherVoidRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class QuotaAdjustRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    delta_points: int = Field(ge=-100_000, le=100_000)
    reason: str = Field(min_length=1, max_length=500)


class VoiceQuotaAdjustRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    delta_minutes: int = Field(ge=-120_000, le=120_000)
    reason: str = Field(min_length=1, max_length=500)


def _error(exc: billing.BillingError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/me", dependencies=[Depends(require_auth)])
async def billing_me() -> dict[str, Any]:
    user = get_current_user()
    snapshot = billing.account_snapshot(user.id)
    return {
        **snapshot,
        "username": user.username,
        "is_admin": user.is_admin,
        "phase": "A",
        "payment_provider": "ldxp_manual_voucher",
    }


@router.get("/ledger", dependencies=[Depends(require_auth)])
async def billing_ledger() -> dict[str, Any]:
    user = get_current_user()
    return {
        "items": billing.list_ledger(user.id),
        "voice_items": billing.list_voice_ledger(user.id),
        "usage": billing.list_usage(user.id),
    }


@router.post("/redeem", dependencies=[Depends(require_auth)])
async def redeem_voucher(payload: RedeemRequest) -> dict[str, Any]:
    user = get_current_user()
    try:
        return billing.redeem_voucher(
            user.id,
            payload.code,
            request_id=payload.request_id or f"redeem_{uuid4().hex}",
        )
    except billing.BillingError as exc:
        raise _error(exc) from exc


@router.get("/plans")
async def public_plans() -> dict[str, Any]:
    return {"items": billing.list_plans()}


@router.get("/admin/plans", dependencies=[Depends(require_admin)])
async def admin_plans() -> dict[str, Any]:
    return {"items": billing.list_plans(include_disabled=True)}


@router.post("/admin/vouchers/import", dependencies=[Depends(require_admin)])
async def admin_import_vouchers(payload: VoucherImportRequest) -> dict[str, Any]:
    try:
        return billing.import_vouchers(payload.plan_code, payload.codes, batch_id=payload.batch_id)
    except billing.BillingError as exc:
        raise _error(exc) from exc


@router.get("/admin/vouchers", dependencies=[Depends(require_admin)])
async def admin_vouchers() -> dict[str, Any]:
    return {"items": billing.list_vouchers()}


@router.post("/admin/vouchers/{voucher_id}/void", dependencies=[Depends(require_admin)])
async def admin_void_voucher(voucher_id: str, payload: VoucherVoidRequest) -> dict[str, Any]:
    user = get_current_user()
    changed = billing.void_voucher(voucher_id, admin_id=user.id, reason=payload.reason)
    if not changed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="卡密不存在或已不能作废。"
        )
    return {"ok": True}


@router.get("/admin/redemptions", dependencies=[Depends(require_admin)])
async def admin_redemptions() -> dict[str, Any]:
    return {"items": billing.list_redemptions()}


@router.post("/admin/quota/adjust", dependencies=[Depends(require_admin)])
async def admin_adjust_quota(payload: QuotaAdjustRequest) -> dict[str, Any]:
    user = get_current_user()
    try:
        return billing.adjust_quota(
            payload.user_id,
            payload.delta_points * 10,
            admin_id=user.id,
            reason=payload.reason,
        )
    except billing.BillingError as exc:
        raise _error(exc) from exc


@router.post("/admin/voice-quota/adjust", dependencies=[Depends(require_admin)])
async def admin_adjust_voice_quota(payload: VoiceQuotaAdjustRequest) -> dict[str, Any]:
    user = get_current_user()
    try:
        return billing.adjust_voice_quota(
            payload.user_id,
            payload.delta_minutes * billing.VOICE_SECONDS_PER_MINUTE,
            admin_id=user.id,
            reason=payload.reason,
        )
    except billing.BillingError as exc:
        raise _error(exc) from exc
