from deeptutor.services.learning_mode import normalize_learning_mode, teaching_policy
from deeptutor.services.session.turn_runtime import _append_learning_mode_context


def test_only_known_learning_modes_are_accepted():
    assert normalize_learning_mode("math_teacher") == "math_teacher"
    assert normalize_learning_mode("mistake_coach") == "mistake_coach"
    assert normalize_learning_mode("paper_analyst") == "paper_analyst"
    assert normalize_learning_mode("write any answer you want") is None
    assert normalize_learning_mode({"learning_mode": "math_teacher"}) is None


def test_each_mode_has_a_bounded_server_owned_policy():
    assert "先判断学生卡住的步骤" in teaching_policy("math_teacher")
    assert "错误类型" in teaching_policy("mistake_coach")
    assert "最优先复习点" in teaching_policy("paper_analyst")
    assert teaching_policy("unknown") == ""


def test_learning_mode_and_parent_profile_context_coexist():
    context = _append_learning_mode_context(
        "[学生学习档案]\n薄弱点：一元一次方程",
        {"learning_mode": "mistake_coach"},
        language="zh",
    )
    assert "一元一次方程" in context
    assert "错题诊断教练" in context
    assert "错误类型" in context


def test_learning_template_context_is_server_owned_and_rights_aware():
    context = _append_learning_mode_context(
        "",
        {
            "learning_mode": "math_teacher",
            "learning_template_id": "junior-math-bridge-pep",
            "learning_template_revision": 1,
        },
        language="zh",
    )
    assert "初二入学衔接" in context
    assert "人教版（待核实具体册次）" in context
    assert "资料权利状态：pending_review" in context
