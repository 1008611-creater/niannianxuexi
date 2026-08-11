"""Parent-owned child profile and controlled first math check-in."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from deeptutor.api.routers.auth import require_active_access
from deeptutor.multi_user.context import get_current_user
from deeptutor.services.learner_profile import get_profile, public_questions, save_profile

router = APIRouter()


class SaveProfileRequest(BaseModel):
    child_name: str = Field(min_length=1, max_length=40)
    grade: str = Field(min_length=1, max_length=40)
    textbook_edition: str = Field(min_length=1, max_length=80)
    answers: dict[str, int] = Field(default_factory=dict)

    @field_validator("answers")
    @classmethod
    def answer_count(cls, value: dict[str, int]) -> dict[str, int]:
        if len(value) > 10:
            raise ValueError("Too many assessment answers")
        return value


@router.get("/questions", dependencies=[Depends(require_active_access)])
async def questions() -> dict[str, Any]:
    return {"version": 1, "questions": public_questions()}


@router.get("/profile", dependencies=[Depends(require_active_access)])
async def profile() -> dict[str, Any]:
    return {"profile": get_profile()}


@router.post("/profile", dependencies=[Depends(require_active_access)])
async def create_profile(body: SaveProfileRequest) -> dict[str, Any]:
    if not get_current_user().id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "profile": save_profile(
            child_name=body.child_name,
            grade=body.grade,
            textbook_edition=body.textbook_edition,
            answers=body.answers,
        )
    }
