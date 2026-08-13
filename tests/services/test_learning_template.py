import pytest

from deeptutor.services.learning_template import (
    JUNIOR_MATH_BRIDGE_ID,
    resolve_learning_template,
    template_context,
)


def test_published_template_resolves_with_explicit_revision():
    template = resolve_learning_template(JUNIOR_MATH_BRIDGE_ID, 1)
    assert template is not None
    assert template["grade"] == "初二入学衔接"
    assert template["textbook_edition"] == "人教版（待核实具体册次）"
    assert template["rights_status"] == "pending_review"


def test_unknown_or_stale_template_is_rejected():
    with pytest.raises(ValueError, match="未知学习模板"):
        resolve_learning_template("not-a-real-template", 1)
    with pytest.raises(ValueError, match="版本已更新"):
        resolve_learning_template(JUNIOR_MATH_BRIDGE_ID, 99)


def test_template_context_keeps_unverified_materials_explicit():
    template = resolve_learning_template(JUNIOR_MATH_BRIDGE_ID)
    context = template_context(template, learning_mode="math_teacher")
    assert "初二入学衔接" in context
    assert "人教版（待核实具体册次）" in context
    assert "资料权利状态：pending_review" in context
    assert "不得编造来源" in context
    assert "念念数学老师" in context
