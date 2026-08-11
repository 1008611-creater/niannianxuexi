"""Deterministic answer grading + coarse error classification for Mastery Path."""

from __future__ import annotations

import ast
from difflib import SequenceMatcher
from fractions import Fraction
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from deeptutor.learning.models import ErrorType


def grade_answer(user_answer: str, expected_answer: str, question_type: str = "short") -> bool:
    """Grade user answer against expected answer.

    Args:
        user_answer: The user's submitted answer.
        expected_answer: The stored expected answer.
        question_type: One of "choice", "short", "open".

    Returns:
        True if answer is correct.
    """
    user = user_answer.strip().lower()
    expected = expected_answer.strip().lower()

    if not expected:
        return False

    if question_type == "choice":
        user_norm = user.replace(" ", "")
        expected_norm = expected.replace(" ", "")
        return user_norm == expected_norm

    if question_type == "short":
        if user == expected:
            return True
        user_number = _parse_simple_numeric_answer(user)
        expected_number = _parse_simple_numeric_answer(expected)
        if user_number is not None and expected_number is not None:
            return user_number == expected_number
        if _looks_like_numeric_expression(user) or _looks_like_numeric_expression(expected):
            return False
        if len(expected) <= 30:
            return SequenceMatcher(None, user, expected).ratio() >= 0.85
        return False

    if question_type == "open":
        keywords = [k.strip() for k in re.split(r"[,;，；。\n]+", expected) if k.strip()]
        if not keywords:
            return False
        matched = sum(1 for kw in keywords if kw in user)
        return matched / len(keywords) >= 0.6

    return False


_ASSIGNMENT_ANSWER = re.compile(r"^\s*[a-zA-Z]\w*\s*=\s*(.+?)\s*$")
_NUMERIC_EXPRESSION = re.compile(r"^[0-9.+\-*/^()×÷\s]+$")
_MAX_NUMERIC_EXPRESSION_LENGTH = 80


def _looks_like_numeric_expression(answer: str) -> bool:
    """Tell arithmetic-looking answers apart from ordinary short text."""
    return bool(_NUMERIC_EXPRESSION.fullmatch(answer.strip())) and any(
        char.isdigit() for char in answer
    )


def _parse_simple_numeric_answer(answer: str) -> Fraction | None:
    """Evaluate a bounded arithmetic answer exactly, without variables.

    A learner may write a bare value, a fraction, an arithmetic expression, or
    a simple assignment such as ``x = 1/2``. This deliberately excludes
    algebraic expressions with variables and function calls. ``Fraction``
    preserves exact equivalence such as ``1/2 == 0.5``.
    """
    raw = answer.strip().replace("％", "%")
    assignment = _ASSIGNMENT_ANSWER.match(raw)
    if assignment:
        raw = assignment.group(1)
    is_percentage = raw.endswith("%")
    if is_percentage:
        raw = raw[:-1].strip()
    if not raw or len(raw) > _MAX_NUMERIC_EXPRESSION_LENGTH or not _looks_like_numeric_expression(raw):
        return None
    try:
        parsed = ast.parse(raw.replace("×", "*").replace("÷", "/").replace("^", "**"), mode="eval")
        value = _evaluate_numeric_expression(parsed.body)
        return value / 100 if is_percentage else value
    except (SyntaxError, ValueError, ZeroDivisionError):
        return None


def _evaluate_numeric_expression(node: ast.expr) -> Fraction:
    """Safely evaluate the limited arithmetic grammar accepted above."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return Fraction(str(node.value))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = _evaluate_numeric_expression(node.operand)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp):
        left = _evaluate_numeric_expression(node.left)
        right = _evaluate_numeric_expression(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.Pow):
            if right.denominator != 1 or right < 0 or right > 10:
                raise ValueError("unsupported exponent")
            return left ** right.numerator
    raise ValueError("unsupported numeric expression")


def classify_error(user_answer: str, expected_answer: str = "") -> ErrorType:
    """Coarse error classification for a wrong answer.

    A blank answer signals the student did not know (metacognitive). For the
    common, unambiguous case where a numeric answer has exactly the opposite
    sign of the expected answer, record a deviation (a sign/calculation
    slip). Other nonblank errors remain application errors until the tutor can
    explain their richer cause from the full problem context.
    """
    from deeptutor.learning.models import ErrorType

    if not user_answer.strip():
        return ErrorType.METACOGNITIVE

    actual = _parse_simple_numeric_answer(user_answer)
    expected = _parse_simple_numeric_answer(expected_answer)
    if actual is not None and expected is not None and actual != 0 and actual == -expected:
        return ErrorType.UNDERSTANDING_DEVIATION

    return ErrorType.APPLICATION_ERROR


__all__ = ["grade_answer", "classify_error"]
