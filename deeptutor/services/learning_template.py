"""Server-owned allowlist for ready-to-use learning templates.

Templates are orchestration metadata. They do not create a second curriculum
engine or silently attach unverified copyrighted material.
"""

from __future__ import annotations

from typing import Any, Final

from deeptutor.services.learning_mode import normalize_learning_mode, teaching_policy

JUNIOR_MATH_BRIDGE_ID: Final = "junior-math-bridge-pep"
JUNIOR_MATH_BRIDGE_REVISION: Final = 1

_TEMPLATES: Final[dict[str, dict[str, Any]]] = {
    JUNIOR_MATH_BRIDGE_ID: {
        "id": JUNIOR_MATH_BRIDGE_ID,
        "revision": JUNIOR_MATH_BRIDGE_REVISION,
        "stage": "初中",
        "grade": "初二入学衔接",
        "subject": "数学",
        "textbook_edition": "人教版（待核实具体册次）",
        "region": "全国通用（待核实地区映射）",
        "material_refs": ["pep-junior-math-index (待核实)", "user-uploaded-materials"],
        "persona_ref": "niannian-math-teacher (待核实)",
        "partner_ref": "niannian-math-teacher (待核实)",
        "rights_status": "pending_review",
        "teaching_policy": "guided_first",
    }
}


def resolve_learning_template(template_id: Any, revision: Any = None) -> dict[str, Any] | None:
    """Validate and return a copy of a published template's safe metadata."""
    if not isinstance(template_id, str) or not template_id.strip():
        return None
    template = _TEMPLATES.get(template_id.strip())
    if template is None:
        raise ValueError(f"未知学习模板：{template_id}")
    if revision is not None:
        try:
            requested_revision = int(revision)
        except (TypeError, ValueError) as exc:
            raise ValueError("学习模板修订号无效") from exc
        if requested_revision != int(template["revision"]):
            raise ValueError("学习模板版本已更新，请重新选择")
    return dict(template)


def template_context(template: Any, *, learning_mode: Any = None, language: str = "zh") -> str:
    """Render only verified-safe template facts into the model context."""
    if not isinstance(template, dict) or not template.get("id"):
        return ""
    mode = normalize_learning_mode(learning_mode)
    policy = teaching_policy(mode, language=language) if mode else ""
    is_zh = str(language or "zh").lower().startswith("zh")
    if is_zh:
        lines = [
            "[受控学习模板]",
            f"模板：{template['id']}（修订 {template['revision']}）",
            f"学段/年级：{template['stage']} / {template['grade']}",
            f"学科：{template['subject']}",
            f"教材版本：{template['textbook_edition']}",
            f"地区：{template['region']}",
            f"资料权利状态：{template['rights_status']}（资料引用仍待核实，不得编造来源）",
            "模板只提供学习范围和受控行为，不代表完整课程或已授权全文。",
        ]
    else:
        lines = [
            "[Controlled learning template]",
            f"Template: {template['id']} (revision {template['revision']})",
            f"Stage/grade: {template['stage']} / {template['grade']}",
            f"Subject: {template['subject']}",
            f"Textbook edition: {template['textbook_edition']}",
            f"Region: {template['region']}",
            f"Material rights: {template['rights_status']} (references are unverified; do not invent sources)",
            "This is orchestration metadata, not a complete course or a license for full text.",
        ]
    if policy:
        lines.extend(["", policy])
    return "\n".join(lines)


def template_from_config(config: Any) -> dict[str, Any] | None:
    if not isinstance(config, dict):
        return None
    template_id = config.get("learning_template_id")
    if not template_id:
        return None
    return resolve_learning_template(template_id, config.get("learning_template_revision"))
