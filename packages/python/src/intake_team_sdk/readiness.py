"""Bookkeeping for a Definition of Ready verdict."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from ._generated import IntakeDraft, ReadinessIssue, ReadinessVerdict
from .draft import field_value, filled

CoreFieldKey = Literal["title", "whatNeeded", "urgency", "businessValue", "approver"]


@dataclass(frozen=True)
class EnumFieldMessages:
    """The two messages an enum check can produce."""

    missing: str
    """Shown when the field is absent or blank."""
    invalid: Callable[[str], str]
    """Shown when a value was given that the team does not define."""


class ReadinessReport:
    """
    Collects a Definition of Ready verdict for one draft.

    The rules are the team's; the bookkeeping (two lists, order preserved,
    `ready` derived from the blockers) is not, and every team was writing it out
    by hand. Every message is supplied by the caller, in the team's own words,
    because a blocker is what the requester is asked for.

    Chainable, and the order of the calls is the order the issues are reported
    in.
    """

    def __init__(self, draft: IntakeDraft) -> None:
        self._draft = draft
        self._blockers: list[ReadinessIssue] = []
        self._warnings: list[ReadinessIssue] = []

    def block(self, field: str | None, message: str) -> ReadinessReport:
        """An unconditional blocker, for a rule that has no helper here."""
        self._blockers.append(_issue(field, message))

        return self

    def warn(self, field: str | None, message: str) -> ReadinessReport:
        """Worth having, never blocking."""
        self._warnings.append(_issue(field, message))

        return self

    def block_when(self, condition: bool, field: str, message: str) -> ReadinessReport:
        """A blocker only when the team's own condition holds."""
        return self.block(field, message) if condition else self

    def require_core(self, key: CoreFieldKey, message: str) -> ReadinessReport:
        """One of the host's core fields must be filled in."""
        return self.block_when(not filled(self._draft["core"][key]), key, message)

    def require_field(self, key: str, message: str) -> ReadinessReport:
        """One of the team's own fields must be filled in."""
        return self.block_when(field_value(self._draft, key) is None, key, message)

    def require_enum_field(
        self, key: str, options: Sequence[str], messages: EnumFieldMessages
    ) -> ReadinessReport:
        """
        One of the team's own fields must hold a value the team defines.

        Absent and unrecognised are separate messages because they ask the
        requester for different things: one to answer, one to correct.
        """
        value = field_value(self._draft, key)

        if value is None:
            return self.block(key, messages.missing)

        return self.block_when(value not in options, key, messages.invalid(value))

    def warn_missing_field(self, key: str, message: str) -> ReadinessReport:
        """A field whose absence is worth mentioning but must not block."""
        if field_value(self._draft, key) is not None:
            return self

        return self.warn(key, message)

    def verdict(self) -> ReadinessVerdict:
        return {
            "ready": len(self._blockers) == 0,
            "blockers": list(self._blockers),
            "warnings": list(self._warnings),
        }


def readiness(draft: IntakeDraft) -> ReadinessReport:
    """Starts a `ReadinessReport` for one draft."""
    return ReadinessReport(draft)


def _issue(field: str | None, message: str) -> ReadinessIssue:
    return {"message": message} if field is None else {"field": field, "message": message}
