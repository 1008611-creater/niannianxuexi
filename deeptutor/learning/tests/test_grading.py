"""Tests for the grading module and the unified post-answer pipeline.

``grade_answer`` is the pure correctness check. ``classify_error`` is the
coarse wrong-answer tagger. ``LearningService.grade_and_record`` folds both of
those through the full record -> mastery -> spaced-repetition pipeline and is
fail-closed: with no stored expected answer the attempt is recorded wrong.
"""

from deeptutor.learning.grading import classify_error, grade_answer
from deeptutor.learning.models import (
    ErrorType,
    KnowledgePoint,
    KnowledgeType,
    LearningModule,
    LearningProgress,
)
from deeptutor.learning.scheduler import SpacedRepetitionScheduler
from deeptutor.learning.service import LearningService
from deeptutor.learning.storage import LearningStore


class TestChoiceGrading:
    def test_choice_exact_match(self):
        assert grade_answer("A", "A", "choice") is True

    def test_choice_case_insensitive(self):
        assert grade_answer("b", "B", "choice") is True

    def test_choice_with_spaces(self):
        assert grade_answer("A ", " A", "choice") is True

    def test_choice_wrong(self):
        assert grade_answer("C", "A", "choice") is False


class TestShortGrading:
    def test_short_exact_match(self):
        assert grade_answer("photosynthesis", "photosynthesis", "short") is True

    def test_short_fuzzy_pass(self):
        # "photosynthesi" vs "photosynthesis" — high similarity
        assert grade_answer("photosynthesi", "photosynthesis", "short") is True

    def test_short_fuzzy_fail(self):
        assert grade_answer("completely different", "photosynthesis", "short") is False

    def test_short_numeric_sign_difference_is_not_fuzzy_matched(self):
        assert grade_answer("x=-4", "x=4", "short") is False

    def test_short_numeric_assignment_matches_same_value(self):
        assert grade_answer("x = 4", "4", "short") is True

    def test_short_fraction_matches_equivalent_decimal(self):
        assert grade_answer("1/2", "0.5", "short") is True

    def test_short_equivalent_fractions_match(self):
        assert grade_answer("2/4", "1/2", "short") is True

    def test_short_arithmetic_expression_matches_value(self):
        assert grade_answer("1/3 + 1/6", "0.5", "short") is True

    def test_short_parenthesized_expression_matches_value(self):
        assert grade_answer("3 × (2 + 1)", "9", "short") is True

    def test_short_percentage_matches_equivalent_decimal(self):
        assert grade_answer("20%", "0.2", "short") is True

    def test_short_full_width_percentage_matches_equivalent_fraction(self):
        assert grade_answer("25％", "1/4", "short") is True

    def test_short_numeric_expression_does_not_fall_back_to_fuzzy_text_match(self):
        assert grade_answer("2 + 2", "2 + 3", "short") is False

    def test_short_long_expected_no_fuzzy(self):
        long_expected = "a" * 31  # >30 chars, no fuzzy
        assert grade_answer(long_expected, long_expected, "short") is True
        assert grade_answer("something else entirely", long_expected, "short") is False


class TestOpenGrading:
    def test_open_keywords_pass(self):
        expected = "cell membrane, nucleus, mitochondria"
        user = "The cell has a cell membrane and nucleus, with mitochondria for energy"
        assert grade_answer(user, expected, "open") is True

    def test_open_keywords_fail(self):
        expected = "cell membrane, nucleus, mitochondria"
        user = "I don't know anything about cells"
        assert grade_answer(user, expected, "open") is False

    def test_open_chinese_separators(self):
        expected = "光合作用；叶绿体；二氧化碳"
        user = "光合作用发生在叶绿体中，需要二氧化碳"
        assert grade_answer(user, expected, "open") is True


class TestEdgeCases:
    def test_empty_expected_returns_false(self):
        assert grade_answer("anything", "", "short") is False
        assert grade_answer("anything", "  ", "short") is False

    def test_empty_user_answer(self):
        assert grade_answer("", "expected", "short") is False

    def test_substring_no_longer_matches(self):
        """Regression: 'expected in user' substring match must not cause false positive."""
        user = "I do not know electromagnetic induction but maybe something else"
        expected = "electromagnetic induction"
        assert grade_answer(user, expected, "short") is False

    def test_unknown_type_returns_false(self):
        assert grade_answer("a", "a", "unknown") is False


class TestClassifyError:
    """Deterministic wrong-answer tagging used by the post-answer pipeline."""

    def test_blank_answer_is_metacognitive(self):
        assert classify_error("") is ErrorType.METACOGNITIVE

    def test_whitespace_only_answer_is_metacognitive(self):
        assert classify_error("   \n\t  ") is ErrorType.METACOGNITIVE

    def test_nonblank_answer_is_application_error(self):
        assert classify_error("the answer is 42") is ErrorType.APPLICATION_ERROR

    def test_opposite_signed_numeric_answer_is_deviation(self):
        assert classify_error("-3", "3") is ErrorType.UNDERSTANDING_DEVIATION

    def test_opposite_signed_assignment_is_deviation(self):
        assert classify_error("x = -2", "x=2") is ErrorType.UNDERSTANDING_DEVIATION

    def test_opposite_signed_fraction_is_deviation(self):
        assert classify_error("-1/2", "0.5") is ErrorType.UNDERSTANDING_DEVIATION

    def test_opposite_signed_percentage_is_deviation(self):
        assert classify_error("-20%", "0.2") is ErrorType.UNDERSTANDING_DEVIATION

    def test_unrelated_numeric_answer_remains_application_error(self):
        assert classify_error("5", "2") is ErrorType.APPLICATION_ERROR


def _progress_with_kp(kp_type: KnowledgeType = KnowledgeType.CONCEPT) -> LearningProgress:
    progress = LearningProgress(book_id="book1")
    progress.modules = [
        LearningModule(
            id="m1",
            name="Module 1",
            order=0,
            knowledge_points=[KnowledgePoint(id="kp1", name="KP1", type=kp_type, module_id="m1")],
        )
    ]
    progress.knowledge_types["kp1"] = kp_type
    return progress


class TestGradeAndRecordFailClosed:
    """``grade_and_record`` is the single post-answer pipeline. It must never
    grade an answer correct when there is no stored expected answer, and it must
    fold correctness through attempt history, mastery, and error records."""

    def test_no_expected_answer_is_wrong_and_records_error(self, tmp_path):
        service = LearningService(LearningStore(root=tmp_path))
        progress = _progress_with_kp()

        result = service.grade_and_record(
            progress,
            question_id="q1",
            knowledge_point_id="kp1",
            module_id="m1",
            user_answer="anything plausible",
            expected_answer="",  # missing expected -> fail-closed
        )

        assert result is False
        assert len(progress.quiz_attempts) == 1
        attempt = progress.quiz_attempts[0]
        assert attempt.is_correct is False
        # Non-blank wrong answer is an application error and opens an error record.
        assert attempt.error_type is ErrorType.APPLICATION_ERROR
        assert len(progress.error_records) == 1
        assert progress.error_records[0].status == "active"
        assert progress.error_records[0].error_type is ErrorType.APPLICATION_ERROR

    def test_blank_wrong_answer_is_metacognitive(self, tmp_path):
        service = LearningService(LearningStore(root=tmp_path))
        progress = _progress_with_kp()

        result = service.grade_and_record(
            progress,
            question_id="q1",
            knowledge_point_id="kp1",
            module_id="m1",
            user_answer="",
            expected_answer="photosynthesis",
        )

        assert result is False
        assert progress.quiz_attempts[0].error_type is ErrorType.METACOGNITIVE

    def test_opposite_signed_answer_records_deviation(self, tmp_path):
        service = LearningService(LearningStore(root=tmp_path))
        progress = _progress_with_kp()

        result = service.grade_and_record(
            progress,
            question_id="q1",
            knowledge_point_id="kp1",
            module_id="m1",
            user_answer="x=-4",
            expected_answer="x=4",
        )

        assert result is False
        assert progress.quiz_attempts[0].error_type is ErrorType.UNDERSTANDING_DEVIATION
        assert progress.error_records[0].error_type is ErrorType.UNDERSTANDING_DEVIATION

    def test_correct_answer_records_and_caps_single_attempt_mastery(self, tmp_path):
        service = LearningService(LearningStore(root=tmp_path))
        progress = _progress_with_kp()

        result = service.grade_and_record(
            progress,
            question_id="q1",
            knowledge_point_id="kp1",
            module_id="m1",
            user_answer="photosynthesis",
            expected_answer="photosynthesis",
        )

        assert result is True
        assert progress.quiz_attempts[0].is_correct is True
        assert progress.quiz_attempts[0].error_type is None
        # A single correct attempt is capped at low confidence (0.5), never 1.0.
        assert progress.mastery_levels["kp1"] == 0.5
        assert progress.error_records == []

    def test_correct_answer_graduates_existing_error_record(self, tmp_path):
        service = LearningService(LearningStore(root=tmp_path))
        progress = _progress_with_kp()

        # First a wrong answer opens an error record...
        service.grade_and_record(
            progress,
            question_id="q1",
            knowledge_point_id="kp1",
            module_id="m1",
            user_answer="wrong guess",
            expected_answer="photosynthesis",
        )
        assert progress.error_records[0].status == "active"

        # ...then a correct retry graduates it.
        service.grade_and_record(
            progress,
            question_id="q1",
            knowledge_point_id="kp1",
            module_id="m1",
            user_answer="photosynthesis",
            expected_answer="photosynthesis",
        )

        assert progress.error_records[0].status == "graduated"

    def test_persists_through_store(self, tmp_path):
        store = LearningStore(root=tmp_path)
        service = LearningService(store)
        progress = _progress_with_kp()

        service.grade_and_record(
            progress,
            question_id="q1",
            knowledge_point_id="kp1",
            module_id="m1",
            user_answer="photosynthesis",
            expected_answer="photosynthesis",
        )

        loaded = store.load("book1")
        assert loaded is not None
        assert len(loaded.quiz_attempts) == 1
        assert loaded.mastery_levels["kp1"] == 0.5

    def test_scheduler_advances_repetition_and_builds_queue(self, tmp_path):
        store = LearningStore(root=tmp_path)
        service = LearningService(store)
        scheduler = SpacedRepetitionScheduler()
        progress = _progress_with_kp(KnowledgeType.CONCEPT)

        service.grade_and_record(
            progress,
            question_id="q1",
            knowledge_point_id="kp1",
            module_id="m1",
            user_answer="photosynthesis",
            expected_answer="photosynthesis",
            scheduler=scheduler,
        )

        # A repetition state was created and the review queue rebuilt from it.
        assert "kp1" in progress.repetition_states
        assert len(progress.review_queue) == 1
        assert progress.review_queue[0].knowledge_point_id == "kp1"
