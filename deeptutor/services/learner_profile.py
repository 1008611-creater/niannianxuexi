"""Account-scoped learner profile and the first controlled math check-in."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import threading
from typing import Any
from uuid import uuid4

from deeptutor.multi_user.paths import get_current_path_service

_LOCK = threading.Lock()

QUESTIONS: tuple[dict[str, Any], ...] = (
    {
        "id": "integer-addition",
        "skill": "有理数运算",
        "prompt": "计算：(-3)+5 = ?",
        "options": ["-8", "-2", "2", "8"],
        "answer": 2,
    },
    {
        "id": "linear-equation",
        "skill": "一元一次方程",
        "prompt": "方程 2x+3=9 的解是？",
        "options": ["2", "3", "4", "6"],
        "answer": 1,
    },
    {
        "id": "linear-function",
        "skill": "一次函数",
        "prompt": "当 x=2 时，y=2x+1 的值是？",
        "options": ["3", "4", "5", "6"],
        "answer": 2,
    },
    {
        "id": "triangle-angle",
        "skill": "三角形内角和",
        "prompt": "三角形两个内角分别是 50° 和 60°，第三个内角是？",
        "options": ["60°", "70°", "80°", "90°"],
        "answer": 1,
    },
)


def _profile_path() -> Path:
    root = get_current_path_service().workspace_root
    path = root / "learning" / "child_profile.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _read() -> dict[str, Any] | None:
    path = _profile_path()
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def get_profile() -> dict[str, Any] | None:
    with _LOCK:
        return _read()


def context_summary(profile: dict[str, Any] | None = None) -> str:
    """Return a small, non-sensitive prompt block for learning turns."""
    profile = profile if profile is not None else get_profile()
    if not profile:
        return ""
    assessment = profile.get("assessment") if isinstance(profile.get("assessment"), dict) else {}
    weak = assessment.get("weak_areas") if isinstance(assessment.get("weak_areas"), list) else []
    return "\n".join(
        [
            "[孩子学习档案]",
            f"称呼：{str(profile.get('child_name') or '孩子')[:40]}",
            f"年级：{str(profile.get('grade') or '')[:40]}",
            f"教材版本：{str(profile.get('textbook_edition') or '')[:80]}",
            f"摸底结论：{str(assessment.get('level') or '尚未完成')[:80]}",
            "已观察薄弱点：" + ("、".join(str(item)[:40] for item in weak[:6]) or "暂无"),
            "使用规则：先结合这份档案调整讲解难度和追问方式；不要向学生展示内部 Agent 配置，也不要把摸底分数当作正式成绩。",
        ]
    )


def public_questions() -> list[dict[str, Any]]:
    return [
        {"id": q["id"], "skill": q["skill"], "prompt": q["prompt"], "options": q["options"]}
        for q in QUESTIONS
    ]


def save_profile(
    *, child_name: str, grade: str, textbook_edition: str, answers: dict[str, int]
) -> dict[str, Any]:
    clean_answers = {str(k): int(v) for k, v in answers.items() if str(k)}
    results = []
    for question in QUESTIONS:
        choice = clean_answers.get(question["id"])
        if choice is None or choice < 0 or choice >= len(question["options"]):
            continue
        results.append(
            {
                "question_id": question["id"],
                "skill": question["skill"],
                "correct": choice == question["answer"],
            }
        )
    score = sum(1 for result in results if result["correct"])
    weak_areas = [result["skill"] for result in results if not result["correct"]]
    if score <= 1:
        level = "需要从基础补强"
    elif score <= 3:
        level = "正在建立方法"
    else:
        level = "基础较稳，可挑战综合题"
    now = datetime.now(timezone.utc).isoformat()
    profile = {
        "id": f"child_{uuid4().hex}",
        "child_name": child_name.strip()[:40],
        "grade": grade.strip()[:40],
        "textbook_edition": textbook_edition.strip()[:80],
        "assessment": {
            "version": 1,
            "answered": len(results),
            "score": score,
            "total": len(QUESTIONS),
            "level": level,
            "weak_areas": weak_areas,
            "results": results,
        },
        "agent_presets": [
            {
                "id": "niannian-math-teacher",
                "name": "念念数学老师",
                "purpose": "结合孩子的题目、错因和表达方式讲清楚",
            },
            {
                "id": "mistake-coach",
                "name": "错题诊断教练",
                "purpose": "追踪薄弱点，安排复习和变式练习",
            },
            {
                "id": "parent-learning-assistant",
                "name": "家长学习助手",
                "purpose": "把进度转成家长能执行的建议",
            },
        ],
        "profile_revision": 1,
        "created_at": now,
        "updated_at": now,
        "rights_status": "profile_only_no_external_materials",
    }
    path = _profile_path()
    with _LOCK:
        path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    return profile
