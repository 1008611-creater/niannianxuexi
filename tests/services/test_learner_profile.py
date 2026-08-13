from pathlib import Path

import pytest

from deeptutor.services import learner_profile


class _PathService:
    def __init__(self, root: Path):
        self.workspace_root = root


def test_questions_hide_answers(monkeypatch, tmp_path):
    monkeypatch.setattr(learner_profile, "get_current_path_service", lambda: _PathService(tmp_path))

    questions = learner_profile.public_questions()

    assert len(questions) == 4
    assert all("answer" not in question for question in questions)
    assert questions[0]["options"] == ["-8", "-2", "2", "8"]


def test_profile_is_scoped_and_builds_agent_context(monkeypatch, tmp_path):
    monkeypatch.setattr(learner_profile, "get_current_path_service", lambda: _PathService(tmp_path))

    profile = learner_profile.save_profile(
        child_name="小宇",
        grade="初二入学",
        textbook_edition="人教版（具体册次待确认）",
        answers={
            "integer-addition": 2,
            "linear-equation": 0,
            "linear-function": 2,
            "triangle-angle": 0,
        },
    )

    assert learner_profile.get_profile() == profile
    assert profile["assessment"]["score"] == 2
    assert "一元一次方程" in profile["assessment"]["weak_areas"]
    assert profile["assessment"]["results"][0]["choice"] == 2
    assert len(profile["agent_presets"]) == 3
    summary = learner_profile.context_summary(profile)
    assert "小宇" in summary
    assert "不要向学生展示内部 Agent 配置" in summary


def test_profile_updates_keep_binding_id_and_increment_revision(monkeypatch, tmp_path):
    monkeypatch.setattr(learner_profile, "get_current_path_service", lambda: _PathService(tmp_path))
    answers = {question["id"]: 0 for question in learner_profile.QUESTIONS}

    first = learner_profile.save_profile(
        child_name="小宇",
        grade="初二入学",
        textbook_edition="人教版",
        answers=answers,
    )
    second = learner_profile.save_profile(
        child_name="小宇",
        grade="初二",
        textbook_edition="人教版",
        answers={question["id"]: 1 for question in learner_profile.QUESTIONS},
    )

    assert second["id"] == first["id"]
    assert second["profile_revision"] == 2
    assert second["created_at"] == first["created_at"]
    assert second["updated_at"] != first["updated_at"]


def test_profile_rejects_incomplete_or_invalid_answers(monkeypatch, tmp_path):
    monkeypatch.setattr(learner_profile, "get_current_path_service", lambda: _PathService(tmp_path))
    with pytest.raises(ValueError, match="完成全部"):
        learner_profile.save_profile(
            child_name="小宇",
            grade="初二",
            textbook_edition="人教版",
            answers={},
        )
    with pytest.raises(ValueError, match="选项无效"):
        learner_profile.save_profile(
            child_name="小宇",
            grade="初二",
            textbook_edition="人教版",
            answers={question["id"]: 99 for question in learner_profile.QUESTIONS},
        )
