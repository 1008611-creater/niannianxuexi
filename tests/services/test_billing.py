from __future__ import annotations

from pathlib import Path

import pytest

from deeptutor.services import billing


@pytest.fixture
def billing_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "system"
    monkeypatch.setattr(billing, "SYSTEM_ROOT", root)
    monkeypatch.setattr(
        billing,
        "get_user_by_id",
        lambda user_id: ("student", {"id": user_id, "access_source": "pending"}),
    )
    monkeypatch.setattr(billing, "set_access", lambda *args, **kwargs: True)
    return root


def test_redeem_imported_voucher_is_one_time_and_grants_quota(billing_root: Path) -> None:
    assert billing.list_plans()[0]["name"] == "念念数学学习月卡"
    imported = billing.import_vouchers("DT-M-399", ["  DT-TEST-0001  "])
    assert imported["inserted"] == 1

    result = billing.redeem_voucher("u_student", "DT-TEST-0001", request_id="request-1")
    assert result["membership_type"] == "monthly"
    assert result["text_balance_points"] == 800.0
    assert result["plan"]["code"] == "DT-M-399"

    with pytest.raises(billing.BillingError, match="无效、已使用或已作废"):
        billing.redeem_voucher("u_student", "DT-TEST-0001", request_id="request-2")


def test_redeem_same_request_is_idempotent(billing_root: Path) -> None:
    billing.import_vouchers("DT-Y-2990", ["DT-TEST-0002"])
    first = billing.redeem_voucher("u_student", "DT-TEST-0002", request_id="same-request")
    second = billing.redeem_voucher("u_student", "DT-TEST-0002", request_id="same-request")

    assert second["idempotent"] is True
    assert second["redemption_id"] == first["redemption_id"]
    assert billing.account_snapshot("u_student")["text_balance_points"] == 10000.0


def test_redeem_request_id_cannot_be_reused_by_another_user(billing_root: Path) -> None:
    billing.import_vouchers("DT-M-399", ["DT-TEST-0005", "DT-TEST-0006"])
    billing.redeem_voucher("u_student", "DT-TEST-0005", request_id="shared-request")

    with pytest.raises(billing.BillingError, match="其他账户"):
        billing.redeem_voucher("u_other", "DT-TEST-0006", request_id="shared-request")


def test_reservation_settlement_refunds_unused_balance(billing_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    billing.import_vouchers("DT-M-399", ["DT-TEST-0003"])
    billing.redeem_voucher("u_student", "DT-TEST-0003", request_id="request-3")
    monkeypatch.setattr(billing, "_current_payment_user", lambda user_id: True)
    monkeypatch.setattr(
        billing,
        "get_current_user",
        lambda: type("User", (), {"is_admin": False})(),
    )

    assert billing.reserve_turn("u_student", "turn-1") is True
    assert billing.account_snapshot("u_student")["text_balance_points"] == 0.0
    billing.settle_turn(
        "u_student",
        "turn-1",
        summary={"prompt_tokens": 1000, "completion_tokens": 2000, "total_tokens": 3000},
        capability="chat",
        status="completed",
    )
    assert billing.account_snapshot("u_student")["text_balance_points"] == 799.7


def test_void_voucher_prevents_redemption(billing_root: Path) -> None:
    billing.import_vouchers("DT-L-6990", ["DT-TEST-0004"], batch_id="batch-4")
    voucher = billing.list_vouchers()[0]
    assert billing.void_voucher(voucher["id"], admin_id="local-admin", reason="测试作废") is True
    with pytest.raises(billing.BillingError, match="无效、已使用或已作废"):
        billing.redeem_voucher("u_student", "DT-TEST-0004", request_id="request-4")


def test_redeem_grants_realtime_voice_minutes(billing_root: Path) -> None:
    billing.import_vouchers("DT-M-399", ["DT-VOICE-0001"])
    result = billing.redeem_voucher("u_student", "DT-VOICE-0001", request_id="voice-request")
    assert result["voice_balance_minutes"] == 30.0
    assert result["voice_balance_seconds"] == 1_800


def test_voice_reservation_refunds_unused_seconds(billing_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    billing.import_vouchers("DT-M-399", ["DT-VOICE-0002"])
    billing.redeem_voucher("u_student", "DT-VOICE-0002", request_id="voice-request-2")
    monkeypatch.setattr(billing, "get_current_user", lambda: type("User", (), {"is_admin": False})())

    reservation = billing.reserve_voice_session("u_student", "voice-session-1", 600)
    assert reservation == {"reserved_seconds": 600, "remaining_seconds": 1_200}
    billing.settle_voice_session("u_student", "voice-session-1", elapsed_seconds=37.4)
    snapshot = billing.account_snapshot("u_student")
    assert snapshot["voice_balance_seconds"] == 1_763
    assert snapshot["voice_balance_minutes"] == 29.4


def test_admin_can_adjust_voice_minutes(billing_root: Path) -> None:
    result = billing.adjust_voice_quota("u_student", 300, admin_id="local-admin", reason="体验补偿")
    assert result["voice_balance_seconds"] == 300
    assert result["voice_balance_minutes"] == 5.0
