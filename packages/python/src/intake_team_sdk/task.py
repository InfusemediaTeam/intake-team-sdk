"""Creation and status input read strictly, and a team's answers checked."""

from __future__ import annotations

import re
from typing import Any

from ._generated import (
    CreateTaskInput,
    TaskReference,
    TaskStatusResult,
    ToolErrorBody,
    ToolErrorCode,
)
from ._text import js_length, non_blank
from .draft import to_intake_draft

# Mirrors `CreateTaskInput.idempotencyKey` in `spec/`. `fullmatch`, because `$`
# in Python also matches before a trailing newline.
_IDEMPOTENCY_KEY = re.compile(r"[A-Za-z0-9._:-]{1,128}")

_MAX_USER_ID_LENGTH = 128

_MAX_TASK_IDS = 50

_MAX_TASK_ID_LENGTH = 256

_TASK_URL = re.compile(r"https?://")

_STATUS_CATEGORIES = ("todo", "in_progress", "done")

_MISSING: Any = object()


class TaskError(Exception):
    """
    A failure a department reports on purpose, e.g. its board refusing the task.

    Raised from `create_task` or `get_task_status`; the server turns it into the
    contract's error result. The message reaches the requester, so it must not
    carry credentials, stack traces or an upstream payload. Anything else
    raised is reported as `INTERNAL` with a generic message.
    """

    def __init__(self, code: ToolErrorCode, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code: ToolErrorCode = code
        self.message = message
        self.retryable = retryable

    def to_body(self) -> ToolErrorBody:
        return {"code": self.code, "message": self.message, "retryable": self.retryable}


def to_create_task_input(args: Any) -> CreateTaskInput:
    """
    Reads `intake_create_task` arguments.

    Strict where a draft is lenient: a draft that cannot be read only fails
    readiness, but a task created without a stable key or a requester cannot be
    deduplicated or attributed, so either one refuses the call.

    Raises `TaskError` `INVALID_INPUT`.
    """
    source = args if isinstance(args, dict) else {}
    requester = source.get("requester")
    requester = requester if isinstance(requester, dict) else {}
    idempotency_key = source.get("idempotencyKey")
    user_id = requester.get("userId")
    email = requester.get("email", _MISSING)

    if not isinstance(idempotency_key, str) or not _IDEMPOTENCY_KEY.fullmatch(
        idempotency_key
    ):
        raise TaskError("INVALID_INPUT", "idempotencyKey is missing or malformed")

    if (
        not isinstance(user_id, str)
        or len(user_id) == 0
        or js_length(user_id) > _MAX_USER_ID_LENGTH
    ):
        raise TaskError("INVALID_INPUT", "requester.userId is missing or malformed")

    if email is not None and not isinstance(email, str):
        raise TaskError("INVALID_INPUT", "requester.email must be a string or null")

    return {
        "idempotencyKey": idempotency_key,
        "draft": to_intake_draft(source),
        "requester": {"userId": user_id, "email": email},
    }


def to_task_ids(args: Any) -> list[str]:
    """Raises `TaskError` `INVALID_INPUT`."""
    task_ids = args.get("taskIds") if isinstance(args, dict) else None

    if (
        not isinstance(task_ids, list)
        or len(task_ids) == 0
        or len(task_ids) > _MAX_TASK_IDS
        or not all(
            isinstance(task_id, str)
            and len(task_id) > 0
            and js_length(task_id) <= _MAX_TASK_ID_LENGTH
            for task_id in task_ids
        )
    ):
        raise TaskError(
            "INVALID_INPUT", f"taskIds must list 1 to {_MAX_TASK_IDS} task ids"
        )

    return list(task_ids)


def checked_task_reference(task: Any) -> TaskReference:
    """
    A department's own task reference, checked before it leaves the server.

    A malformed one is the department's bug, so it is reported as `INTERNAL`
    here rather than as a schema failure inside the host.
    """
    source = task if isinstance(task, dict) else {}
    url = source.get("url", _MISSING)
    location = source.get("location", _MISSING)
    valid = (
        non_blank(source.get("id"))
        and non_blank(source.get("displayKey"))
        and (url is None or (isinstance(url, str) and _TASK_URL.match(url) is not None))
        and (location is None or isinstance(location, str))
    )

    if not valid:
        raise TaskError("INTERNAL", "The department returned a malformed task reference")

    return {
        "id": source["id"],
        "displayKey": source["displayKey"],
        "url": url,
        "location": location,
    }


def checked_statuses(result: Any, task_ids: list[str]) -> TaskStatusResult:
    """Only statuses for the ids asked about, each checked; the rest are dropped."""
    asked = set(task_ids)
    listed = result.get("statuses") if isinstance(result, dict) else None
    statuses = [
        status
        for status in (listed if isinstance(listed, list) else [])
        if isinstance(status, dict)
        and isinstance(status.get("taskId"), str)
        and status["taskId"] in asked
        and status.get("category") in _STATUS_CATEGORIES
        and non_blank(status.get("label"))
        and _nullable_text(status.get("assignee", _MISSING))
        and _nullable_text(status.get("lastChangedAt", _MISSING))
    ]

    return {"statuses": statuses}


def _nullable_text(value: Any) -> bool:
    return value is None or isinstance(value, str)
