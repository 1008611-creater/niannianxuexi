"""Phase-A membership, voucher, and text-quota ledger.

The first commercial release deliberately owns only the redemption side of the
flow. LDXP remains the payment/card distributor; this module never contacts it
and never stores a raw voucher after the redemption request returns.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import math
from pathlib import Path
import sqlite3
import threading
from typing import Any, Iterator
from uuid import uuid4

from deeptutor.multi_user.context import get_current_user
from deeptutor.multi_user.identity import get_user_by_id, set_access
from deeptutor.multi_user.paths import SYSTEM_ROOT

TEXT_QUOTA_UNIT_K = 1_000
FALLBACK_TURN_CHARGE_K = 100  # 100k tokens = 10 displayed points.
VOICE_SECONDS_PER_MINUTE = 60

DEFAULT_PLANS: tuple[dict[str, Any], ...] = (
    {
        "code": "DT-M-399",
        "name": "念念数学学习月卡",
        "price_fen": 3990,
        "membership_type": "monthly",
        "duration_days": 30,
        "quota_k_tokens": 8_000,
        "voice_quota_seconds": 1_800,
        "media_quota": 0,
        "description": "30 天会员，800 点文本额度，30 分钟实时语音。",
    },
    {
        "code": "DT-Y-2990",
        "name": "念念数学学习年卡",
        "price_fen": 29_900,
        "membership_type": "annual",
        "duration_days": 365,
        "quota_k_tokens": 100_000,
        "voice_quota_seconds": 36_000,
        "media_quota": 0,
        "description": "365 天会员，10000 点文本额度，600 分钟实时语音。",
    },
    {
        "code": "DT-L-6990",
        "name": "念念数学学习永久会员",
        "price_fen": 69_900,
        "membership_type": "permanent",
        "duration_days": None,
        "quota_k_tokens": 60_000,
        "voice_quota_seconds": 72_000,
        "media_quota": 0,
        "description": "永久身份，6000 点文本额度，1200 分钟实时语音。",
    },
)

# Public LDXP product pages. These are intentionally not credentials or API
# endpoints; the payment provider owns checkout and card delivery.
PLAN_PURCHASE_URLS = {
    "DT-M-399": "https://pay.ldxp.cn/item/gqr84l",
    "DT-Y-2990": "https://pay.ldxp.cn/item/6jvubo",
    "DT-L-6990": "https://pay.ldxp.cn/item/i7gl94",
}

_SCHEMA_LOCK = threading.Lock()


class BillingError(RuntimeError):
    """A user-visible billing operation failure."""


def _db_path() -> Path:
    return SYSTEM_ROOT / "billing.sqlite3"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    conn.execute("PRAGMA journal_mode = WAL")
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    with _SCHEMA_LOCK:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS plans (
                code TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                price_fen INTEGER NOT NULL,
                membership_type TEXT NOT NULL,
                duration_days INTEGER,
                quota_k_tokens INTEGER NOT NULL,
                voice_quota_seconds INTEGER NOT NULL DEFAULT 0,
                media_quota INTEGER NOT NULL DEFAULT 0,
                description TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS vouchers (
                id TEXT PRIMARY KEY,
                code_hash TEXT NOT NULL UNIQUE,
                last4 TEXT NOT NULL,
                plan_code TEXT NOT NULL REFERENCES plans(code),
                batch_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'available',
                imported_at TEXT NOT NULL,
                redeemed_at TEXT,
                redeemed_by TEXT,
                voided_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
            CREATE TABLE IF NOT EXISTS redemptions (
                id TEXT PRIMARY KEY,
                voucher_id TEXT NOT NULL UNIQUE REFERENCES vouchers(id),
                user_id TEXT NOT NULL,
                plan_code TEXT NOT NULL REFERENCES plans(code),
                redeemed_at TEXT NOT NULL,
                request_id TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS memberships (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                plan_code TEXT NOT NULL REFERENCES plans(code),
                membership_type TEXT NOT NULL,
                starts_at TEXT NOT NULL,
                expires_at TEXT,
                source TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                redemption_id TEXT REFERENCES redemptions(id),
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, status);
            CREATE TABLE IF NOT EXISTS quota_accounts (
                user_id TEXT PRIMARY KEY,
                text_balance_k_tokens INTEGER NOT NULL DEFAULT 0,
                voice_balance_seconds INTEGER NOT NULL DEFAULT 0,
                media_balance INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS quota_ledger (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                delta_k_tokens INTEGER NOT NULL,
                balance_after_k_tokens INTEGER NOT NULL,
                reason TEXT NOT NULL,
                reference_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, reason, reference_id)
            );
            CREATE TABLE IF NOT EXISTS quota_reservations (
                turn_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                reserved_k_tokens INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'reserved',
                actual_k_tokens INTEGER,
                created_at TEXT NOT NULL,
                settled_at TEXT
            );
            CREATE TABLE IF NOT EXISTS voice_quota_ledger (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                delta_seconds INTEGER NOT NULL,
                balance_after_seconds INTEGER NOT NULL,
                reason TEXT NOT NULL,
                reference_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, reason, reference_id)
            );
            CREATE TABLE IF NOT EXISTS voice_quota_reservations (
                session_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                reserved_seconds INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'reserved',
                actual_seconds INTEGER,
                created_at TEXT NOT NULL,
                settled_at TEXT
            );
            CREATE TABLE IF NOT EXISTS usage_events (
                request_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                capability TEXT NOT NULL,
                model TEXT NOT NULL DEFAULT '',
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                charged_k_tokens INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, created_at);
            CREATE TABLE IF NOT EXISTS admin_actions (
                id TEXT PRIMARY KEY,
                admin_id TEXT NOT NULL,
                target TEXT NOT NULL,
                action TEXT NOT NULL,
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(plans)").fetchall()}
        if "voice_quota_seconds" not in columns:
            conn.execute("ALTER TABLE plans ADD COLUMN voice_quota_seconds INTEGER NOT NULL DEFAULT 0")
        account_columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(quota_accounts)").fetchall()}
        if "voice_balance_seconds" not in account_columns:
            conn.execute("ALTER TABLE quota_accounts ADD COLUMN voice_balance_seconds INTEGER NOT NULL DEFAULT 0")
        now = _now()
        for plan in DEFAULT_PLANS:
            conn.execute(
                """
                INSERT OR IGNORE INTO plans
                    (code, name, price_fen, membership_type, duration_days,
                     quota_k_tokens, voice_quota_seconds, media_quota, description, enabled, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    plan["code"],
                    plan["name"],
                    plan["price_fen"],
                    plan["membership_type"],
                    plan["duration_days"],
                    plan["quota_k_tokens"],
                    plan["voice_quota_seconds"],
                    plan["media_quota"],
                    plan["description"],
                    now,
                ),
            )
        for plan in DEFAULT_PLANS:
            conn.execute(
                "UPDATE plans SET voice_quota_seconds = ? WHERE code = ? AND voice_quota_seconds = 0",
                (plan["voice_quota_seconds"], plan["code"]),
            )
            conn.execute(
                "UPDATE plans SET name = ? WHERE code = ? AND name != ?",
                (plan["name"], plan["code"], plan["name"]),
            )


@contextmanager
def _transaction() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _normalize_code(code: str) -> str:
    normalized = str(code or "").strip()
    if not normalized or len(normalized) > 256:
        raise BillingError("卡密格式不正确。")
    return normalized


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def _current_payment_user(user_id: str) -> bool:
    found = get_user_by_id(user_id)
    if not found:
        return False
    _, record = found
    return str(record.get("access_source") or "") == "payment"


def list_plans(*, include_disabled: bool = False) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        query = "SELECT * FROM plans"
        if not include_disabled:
            query += " WHERE enabled = 1"
        query += " ORDER BY price_fen ASC"
        return [
            {
                **dict(row),
                "purchase_url": PLAN_PURCHASE_URLS.get(str(row["code"])),
            }
            for row in conn.execute(query).fetchall()
        ]
    finally:
        conn.close()


def import_vouchers(plan_code: str, codes: list[str], *, batch_id: str | None = None) -> dict[str, Any]:
    cleaned = [_normalize_code(code) for code in codes if str(code or "").strip()]
    if not cleaned:
        raise BillingError("至少提供一张卡密。")
    if len(cleaned) > 500:
        raise BillingError("单批最多导入 500 张卡密。")
    batch = str(batch_id or f"batch_{uuid4().hex[:12]}").strip()
    if not batch or len(batch) > 128:
        raise BillingError("批次号格式不正确。")

    with _transaction() as conn:
        plan = conn.execute("SELECT code FROM plans WHERE code = ? AND enabled = 1", (plan_code,)).fetchone()
        if plan is None:
            raise BillingError("套餐不存在或已停用。")
        inserted = 0
        duplicates = 0
        now = _now()
        for code in dict.fromkeys(cleaned):
            code_hash = _hash_code(code)
            try:
                conn.execute(
                    """
                    INSERT INTO vouchers
                        (id, code_hash, last4, plan_code, batch_id, status, imported_at)
                    VALUES (?, ?, ?, ?, ?, 'available', ?)
                    """,
                    (f"v_{uuid4().hex}", code_hash, code[-4:], plan_code, batch, now),
                )
                inserted += 1
            except sqlite3.IntegrityError:
                duplicates += 1
    return {"batch_id": batch, "inserted": inserted, "duplicates": duplicates}


def _ensure_quota_account(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    conn.execute(
        """
        INSERT OR IGNORE INTO quota_accounts(
            user_id, text_balance_k_tokens, voice_balance_seconds, media_balance, updated_at
        ) VALUES (?, 0, 0, 0, ?)
        """,
        (user_id, _now()),
    )
    return conn.execute("SELECT * FROM quota_accounts WHERE user_id = ?", (user_id,)).fetchone()


def _ledger(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    delta: int,
    reason: str,
    reference_id: str,
) -> int:
    account = _ensure_quota_account(conn, user_id)
    current = int(account["text_balance_k_tokens"])
    next_balance = current + int(delta)
    conn.execute(
        "UPDATE quota_accounts SET text_balance_k_tokens = ?, updated_at = ? WHERE user_id = ?",
        (next_balance, _now(), user_id),
    )
    conn.execute(
        """
        INSERT OR IGNORE INTO quota_ledger
            (id, user_id, delta_k_tokens, balance_after_k_tokens, reason, reference_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (f"l_{uuid4().hex}", user_id, delta, next_balance, reason, reference_id, _now()),
    )
    return next_balance


def _voice_ledger(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    delta: int,
    reason: str,
    reference_id: str,
) -> int:
    account = _ensure_quota_account(conn, user_id)
    current = int(account["voice_balance_seconds"])
    next_balance = current + int(delta)
    if next_balance < 0:
        raise BillingError("实时语音额度不足。")
    conn.execute(
        "UPDATE quota_accounts SET voice_balance_seconds = ?, updated_at = ? WHERE user_id = ?",
        (next_balance, _now(), user_id),
    )
    conn.execute(
        """
        INSERT OR IGNORE INTO voice_quota_ledger
            (id, user_id, delta_seconds, balance_after_seconds, reason, reference_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (f"vl_{uuid4().hex}", user_id, delta, next_balance, reason, reference_id, _now()),
    )
    return next_balance


def redeem_voucher(user_id: str, code: str, *, request_id: str) -> dict[str, Any]:
    normalized = _normalize_code(code)
    if not request_id or len(request_id) > 128:
        raise BillingError("兑换请求无效，请重试。")

    with _transaction() as conn:
        existing_request = conn.execute(
            "SELECT id, user_id FROM redemptions WHERE request_id = ?", (request_id,)
        ).fetchone()
        if existing_request is not None:
            if str(existing_request["user_id"]) != str(user_id):
                raise BillingError("兑换请求号已被其他账户使用，请重新发起兑换。")
            current = _account_snapshot(conn, user_id)
            return {"redemption_id": existing_request["id"], **current, "idempotent": True}

        voucher = conn.execute(
            "SELECT * FROM vouchers WHERE code_hash = ?", (_hash_code(normalized),)
        ).fetchone()
        if voucher is None or voucher["status"] != "available":
            raise BillingError("卡密无效、已使用或已作废。")
        plan = conn.execute("SELECT * FROM plans WHERE code = ? AND enabled = 1", (voucher["plan_code"],)).fetchone()
        if plan is None:
            raise BillingError("该卡密对应的套餐已停用，请联系管理员。")
        now_dt = datetime.now(timezone.utc)
        now = now_dt.isoformat()
        existing = conn.execute(
            """
            SELECT * FROM memberships
            WHERE user_id = ? AND status = 'active'
            ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END DESC, expires_at DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        existing_expiry = _parse_time(existing["expires_at"]) if existing else None
        new_type = str(plan["membership_type"])
        if new_type == "permanent" or (existing and existing["membership_type"] == "permanent"):
            expires_at = None
            membership_type = "permanent"
        else:
            base = existing_expiry if existing_expiry and existing_expiry > now_dt else now_dt
            expires_at = (base + timedelta(days=int(plan["duration_days"]))).isoformat()
            membership_type = new_type

        redemption_id = f"r_{uuid4().hex}"
        membership_id = f"m_{uuid4().hex}"
        changed = conn.execute(
            "UPDATE vouchers SET status = 'redeemed', redeemed_at = ?, redeemed_by = ? WHERE id = ? AND status = 'available'",
            (now, user_id, voucher["id"]),
        ).rowcount
        if changed != 1:
            raise BillingError("卡密已被其他请求兑换，请刷新后查看账户状态。")
        conn.execute(
            "INSERT INTO redemptions(id, voucher_id, user_id, plan_code, redeemed_at, request_id) VALUES (?, ?, ?, ?, ?, ?)",
            (redemption_id, voucher["id"], user_id, plan["code"], now, request_id),
        )
        if existing:
            conn.execute("UPDATE memberships SET status = 'superseded' WHERE id = ?", (existing["id"],))
        conn.execute(
            """
            INSERT INTO memberships
                (id, user_id, plan_code, membership_type, starts_at, expires_at, source, status, redemption_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'payment', 'active', ?, ?)
            """,
            (membership_id, user_id, plan["code"], membership_type, now, expires_at, redemption_id, now),
        )
        _ledger(
            conn,
            user_id=user_id,
            delta=int(plan["quota_k_tokens"]),
            reason="redeem",
            reference_id=redemption_id,
        )
        _voice_ledger(
            conn,
            user_id=user_id,
            delta=int(plan["voice_quota_seconds"]),
            reason="redeem",
            reference_id=redemption_id,
        )
        snapshot = _account_snapshot(conn, user_id)

    # Keep the existing auth gate in sync. The card/code itself remains only
    # in the request scope and is never persisted by this module.
    found = get_user_by_id(user_id)
    if found:
        username, _ = found
        set_access(username, "active", "payment", expires_at)
    return {
        "redemption_id": redemption_id,
        "plan": dict(plan),
        "membership_type": membership_type,
        "expires_at": expires_at,
        **snapshot,
        "idempotent": False,
    }


def _active_membership(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row | None:
    rows = conn.execute(
        "SELECT * FROM memberships WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC",
        (user_id,),
    ).fetchall()
    now = datetime.now(timezone.utc)
    for row in rows:
        expiry = _parse_time(row["expires_at"])
        if expiry is None or expiry > now:
            return row
    return None


def _account_snapshot(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    account = _ensure_quota_account(conn, user_id)
    membership = _active_membership(conn, user_id)
    plan = None
    if membership:
        plan = conn.execute("SELECT * FROM plans WHERE code = ?", (membership["plan_code"],)).fetchone()
    balance = int(account["text_balance_k_tokens"])
    voice_balance = int(account["voice_balance_seconds"])
    return {
        "user_id": user_id,
        "membership": dict(membership) if membership else None,
        "plan": dict(plan) if plan else None,
        "text_balance_k_tokens": balance,
        "text_balance_points": round(balance / 10, 1),
        "voice_balance_seconds": voice_balance,
        "voice_balance_minutes": round(voice_balance / VOICE_SECONDS_PER_MINUTE, 1),
        "media_balance": int(account["media_balance"]),
    }


def account_snapshot(user_id: str) -> dict[str, Any]:
    conn = _connect()
    try:
        return _account_snapshot(conn, user_id)
    finally:
        conn.close()


def list_vouchers(*, limit: int = 200) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT v.id, v.last4, v.plan_code, p.name AS plan_name, v.batch_id,
                   v.status, v.imported_at, v.redeemed_at, v.redeemed_by
            FROM vouchers v JOIN plans p ON p.code = v.plan_code
            ORDER BY v.imported_at DESC LIMIT ?
            """,
            (max(1, min(int(limit), 500)),),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def list_redemptions(*, limit: int = 200) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT r.id, r.user_id, r.plan_code, p.name AS plan_name,
                   r.redeemed_at, r.request_id
            FROM redemptions r JOIN plans p ON p.code = r.plan_code
            ORDER BY r.redeemed_at DESC LIMIT ?
            """,
            (max(1, min(int(limit), 500)),),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def void_voucher(voucher_id: str, *, admin_id: str, reason: str) -> bool:
    with _transaction() as conn:
        changed = conn.execute(
            "UPDATE vouchers SET status = 'voided', voided_at = ? WHERE id = ? AND status = 'available'",
            (_now(), voucher_id),
        ).rowcount
        if changed:
            conn.execute(
                "INSERT INTO admin_actions(id, admin_id, target, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (f"a_{uuid4().hex}", admin_id, voucher_id, "void_voucher", reason[:500], _now()),
            )
        return bool(changed)


def adjust_quota(user_id: str, delta_k_tokens: int, *, admin_id: str, reason: str) -> dict[str, Any]:
    if not reason.strip():
        raise BillingError("额度调整必须填写原因。")
    if abs(int(delta_k_tokens)) > 1_000_000:
        raise BillingError("单次额度调整过大。")
    with _transaction() as conn:
        balance = _ledger(
            conn,
            user_id=user_id,
            delta=int(delta_k_tokens),
            reason="admin_adjust",
            reference_id=f"{admin_id}:{uuid4().hex}",
        )
        conn.execute(
            "INSERT INTO admin_actions(id, admin_id, target, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (f"a_{uuid4().hex}", admin_id, user_id, "adjust_quota", reason[:500], _now()),
        )
    return {"user_id": user_id, "text_balance_k_tokens": balance, "text_balance_points": round(balance / 10, 1)}


def adjust_voice_quota(user_id: str, delta_seconds: int, *, admin_id: str, reason: str) -> dict[str, Any]:
    if not reason.strip():
        raise BillingError("实时语音额度调整必须填写原因。")
    if abs(int(delta_seconds)) > 7_200_000:
        raise BillingError("单次实时语音额度调整过大。")
    with _transaction() as conn:
        balance = _voice_ledger(
            conn,
            user_id=user_id,
            delta=int(delta_seconds),
            reason="admin_adjust",
            reference_id=f"{admin_id}:{uuid4().hex}",
        )
        conn.execute(
            "INSERT INTO admin_actions(id, admin_id, target, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (f"a_{uuid4().hex}", admin_id, user_id, "adjust_voice_quota", reason[:500], _now()),
        )
    return {
        "user_id": user_id,
        "voice_balance_seconds": balance,
        "voice_balance_minutes": round(balance / VOICE_SECONDS_PER_MINUTE, 1),
    }


def has_active_membership(user_id: str) -> bool:
    conn = _connect()
    try:
        return _active_membership(conn, user_id) is not None
    finally:
        conn.close()


def reserve_voice_session(user_id: str, session_id: str, requested_seconds: int) -> dict[str, int]:
    """Reserve one session's maximum duration and return its remaining balance."""
    if not session_id or requested_seconds <= 0:
        raise BillingError("实时语音会话参数无效。")
    user = get_current_user()
    if user.is_admin:
        return {"reserved_seconds": requested_seconds, "remaining_seconds": requested_seconds}
    with _transaction() as conn:
        if _active_membership(conn, user_id) is None:
            raise BillingError("请先兑换会员，再使用实时语音老师。")
        existing = conn.execute(
            "SELECT status, reserved_seconds FROM voice_quota_reservations WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if existing is not None:
            if existing["status"] != "reserved":
                raise BillingError("实时语音会话已结束，请重新打开。")
            account = _ensure_quota_account(conn, user_id)
            return {
                "reserved_seconds": int(existing["reserved_seconds"]),
                "remaining_seconds": int(account["voice_balance_seconds"]),
            }
        account = _ensure_quota_account(conn, user_id)
        balance = int(account["voice_balance_seconds"])
        if balance <= 0:
            raise BillingError("实时语音额度不足，请购买或兑换新的套餐。")
        reserved = min(balance, int(requested_seconds))
        _voice_ledger(conn, user_id=user_id, delta=-reserved, reason="reserve", reference_id=session_id)
        conn.execute(
            """
            INSERT INTO voice_quota_reservations
                (session_id, user_id, reserved_seconds, status, created_at)
            VALUES (?, ?, ?, 'reserved', ?)
            """,
            (session_id, user_id, reserved, _now()),
        )
        return {"reserved_seconds": reserved, "remaining_seconds": balance - reserved}


def settle_voice_session(
    user_id: str,
    session_id: str,
    *,
    elapsed_seconds: float,
    status: str = "completed",
) -> None:
    user = get_current_user()
    if user.is_admin:
        return
    with _transaction() as conn:
        reservation = conn.execute(
            "SELECT * FROM voice_quota_reservations WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if reservation is None or reservation["status"] != "reserved":
            return
        reserved = int(reservation["reserved_seconds"])
        actual = min(reserved, max(0, int(round(elapsed_seconds))))
        refund = reserved if status != "completed" else reserved - actual
        if refund:
            _voice_ledger(conn, user_id=user_id, delta=refund, reason="settle", reference_id=session_id)
        conn.execute(
            "UPDATE voice_quota_reservations SET status = ?, actual_seconds = ?, settled_at = ? WHERE session_id = ?",
            ("settled" if status == "completed" else "released", actual, _now(), session_id),
        )


def reserve_turn(user_id: str, turn_id: str) -> bool:
    """Lock the whole remaining paid balance until the turn is settled.

    Locking the whole balance prevents two concurrent turns from spending the
    same quota. The settlement path refunds the unused portion, so a normal
    turn still charges its measured usage rather than the entire account.
    """
    user = get_current_user()
    if user.is_admin or not _current_payment_user(user_id):
        return False
    with _transaction() as conn:
        membership = _active_membership(conn, user_id)
        if membership is None:
            raise BillingError("会员已到期，请先兑换新的卡密。")
        existing = conn.execute("SELECT status FROM quota_reservations WHERE turn_id = ?", (turn_id,)).fetchone()
        if existing is not None:
            return existing["status"] == "reserved"
        account = _ensure_quota_account(conn, user_id)
        balance = int(account["text_balance_k_tokens"])
        if balance <= 0:
            raise BillingError("文本额度不足，请兑换新的卡密。")
        _ledger(conn, user_id=user_id, delta=-balance, reason="reserve", reference_id=turn_id)
        conn.execute(
            "INSERT INTO quota_reservations(turn_id, user_id, reserved_k_tokens, status, created_at) VALUES (?, ?, ?, 'reserved', ?)",
            (turn_id, user_id, balance, _now()),
        )
        return True


def _summary_numbers(summary: dict[str, Any] | None) -> tuple[int, int, int]:
    summary = summary or {}
    prompt = max(0, int(summary.get("prompt_tokens") or 0))
    completion = max(0, int(summary.get("completion_tokens") or 0))
    total = max(prompt + completion, int(summary.get("total_tokens") or 0))
    return prompt, completion, total


def settle_turn(
    user_id: str,
    turn_id: str,
    *,
    summary: dict[str, Any] | None,
    capability: str,
    model: str = "",
    status: str = "completed",
) -> None:
    if not _current_payment_user(user_id):
        return
    prompt, completion, total = _summary_numbers(summary)
    with _transaction() as conn:
        reservation = conn.execute("SELECT * FROM quota_reservations WHERE turn_id = ?", (turn_id,)).fetchone()
        if reservation is None or reservation["status"] != "reserved":
            return
        reserved = int(reservation["reserved_k_tokens"])
        charged = max(1, math.ceil(total / TEXT_QUOTA_UNIT_K)) if total else FALLBACK_TURN_CHARGE_K
        if status != "completed":
            charged = 0
        refund_or_overage = reserved - charged
        balance = _ledger(
            conn,
            user_id=user_id,
            delta=refund_or_overage,
            reason="settle",
            reference_id=turn_id,
        )
        conn.execute(
            "UPDATE quota_reservations SET status = ?, actual_k_tokens = ?, settled_at = ? WHERE turn_id = ?",
            ("settled" if status == "completed" else "released", charged, _now(), turn_id),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO usage_events
                (request_id, user_id, turn_id, capability, model, input_tokens,
                 output_tokens, total_tokens, charged_k_tokens, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (f"usage:{turn_id}", user_id, turn_id, capability, model, prompt, completion, total, charged, status, _now()),
        )
        # ``balance`` is intentionally computed even when the result is not
        # returned; it keeps the ledger path exercised and auditable.
        _ = balance


def extract_usage_summary(events: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    """Find the final capability cost summary from persisted stream events."""
    for event in reversed(events):
        metadata = event.get("metadata") if isinstance(event, dict) else None
        if not isinstance(metadata, dict):
            continue
        nested = metadata.get("metadata")
        if isinstance(nested, dict) and isinstance(nested.get("cost_summary"), dict):
            return nested["cost_summary"], str(nested.get("llm_model") or "")
        if isinstance(metadata.get("cost_summary"), dict):
            return metadata["cost_summary"], str(metadata.get("llm_model") or "")
    return None, ""


def list_usage(user_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM usage_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, max(1, min(int(limit), 200))),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def list_ledger(user_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM quota_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, max(1, min(int(limit), 200))),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def list_voice_ledger(user_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM voice_quota_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, max(1, min(int(limit), 200))),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()
