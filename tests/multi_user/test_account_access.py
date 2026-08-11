"""Regression tests for the paid-or-admin account access boundary."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_new_users_are_pending_and_admins_are_active(mu_isolated_root, seed_user):
    from deeptutor.multi_user.identity import list_user_info

    seed_user("alice", role="admin")
    seed_user("bob")
    users = {item["username"]: item for item in list_user_info()}

    assert users["alice"]["access_status"] == "active"
    assert users["bob"]["access_status"] == "pending"


def test_payment_access_expires_and_disabled_state_is_enforced(mu_isolated_root, seed_user):
    from deeptutor.multi_user.identity import effective_access_status, load_users, set_access

    seed_user("alice", role="admin")
    seed_user("bob")
    assert set_access("bob", "active", "payment", (datetime.now(timezone.utc) + timedelta(days=1)).isoformat())
    assert effective_access_status(load_users()["bob"]) == "active"

    assert set_access("bob", "active", "payment", (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    assert effective_access_status(load_users()["bob"]) == "pending"

    assert set_access("bob", "disabled")
    assert effective_access_status(load_users()["bob"]) == "disabled"


def test_protected_route_requires_activation(mu_isolated_root, monkeypatch):
    import deeptutor.api.routers.auth as auth_router
    from deeptutor.multi_user.identity import save_user, set_access
    from deeptutor.services.auth import TokenPayload

    alice = save_user("alice", "$2b$12$placeholder", role="admin")
    bob = save_user("bob", "$2b$12$placeholder", role="user")
    tokens = {
        "admin-token": TokenPayload("alice", "admin", alice["id"]),
        "user-token": TokenPayload("bob", "user", bob["id"]),
    }
    monkeypatch.setattr(auth_router, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth_router, "decode_token", lambda token: tokens.get(token))

    app = FastAPI()

    @app.get("/protected")
    async def protected(_=Depends(auth_router.require_active_access)):
        return {"ok": True}

    @app.get("/status")
    async def status(_=Depends(auth_router.require_auth)):
        return {"ok": True}

    client = TestClient(app)
    assert client.get("/protected", headers=_auth("user-token")).status_code == 403
    assert client.get("/protected", headers=_auth("admin-token")).status_code == 200

    assert set_access("bob", "active", "admin")
    assert client.get("/protected", headers=_auth("user-token")).status_code == 200

    assert set_access("bob", "disabled")
    assert client.get("/protected", headers=_auth("user-token")).status_code == 403
