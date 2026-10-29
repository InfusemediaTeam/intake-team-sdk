"""Reading and searching a draft the way every team does."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ._generated import IntakeDraft
from ._text import js_trim


def filled(value: str | None) -> bool:
    """A present, non-blank value. Blank and absent mean the same thing here."""
    return isinstance(value, str) and len(js_trim(value)) > 0


def field_value(draft: IntakeDraft, key: str) -> str | None:
    value = draft["fieldValues"].get(key)

    return js_trim(value) if filled(value) else None


def to_intake_draft(args: Any) -> IntakeDraft:
    """
    Reads a draft out of a tool call's arguments.

    A server validates its own input for the same reason a host validates a
    server's output: a caller is a caller. Anything unreadable becomes an empty
    draft, which fails the readiness check rather than raising: the host's job
    is to hear "not ready", not to handle an exception from a validator.
    """
    source = args if isinstance(args, dict) else {}
    draft = _record(source.get("draft"))
    core = _record(draft.get("core"))
    requester = _record(draft.get("requester"))

    return {
        "core": {
            "title": _text(core.get("title")),
            "whatNeeded": _text(core.get("whatNeeded")),
            "urgency": _text(core.get("urgency")),
            "businessValue": _text(core.get("businessValue")),
            "approver": _text(core.get("approver")),
        },
        "fieldValues": _string_map(draft.get("fieldValues")),
        "requester": {
            "displayName": _text(requester.get("displayName")),
            "department": _text(requester.get("department")),
        },
    }


def draft_prose(draft: IntakeDraft, field_keys: Iterable[str] = ()) -> str:
    """
    The prose of a draft as one lower-cased haystack, for keyword rules.

    The core fields a requester writes prose into, plus whichever of the team's
    own fields it names: a signal lands in whichever field the requester
    happened to explain themselves in, and a title is often terse. The
    vocabulary being searched for stays with the team; only the gathering is
    generic.
    """
    core = draft["core"]
    parts = [
        core["title"],
        core["whatNeeded"],
        core["businessValue"],
        *(field_value(draft, key) for key in field_keys),
    ]

    return " ".join(part for part in parts if filled(part)).lower()


def includes_any(haystack: str, phrases: Iterable[str]) -> bool:
    """Whether any phrase occurs in the haystack. Phrases are matched as given."""
    return any(phrase in haystack for phrase in phrases)


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str | None:
    """
    One incoming string, normalised the way `field_value` normalises a team
    field: trimmed, and blank read as absent, so a renderer joining core and
    team fields never produces stray whitespace for some drafts only.
    """
    if not isinstance(value, str):
        return None

    trimmed = js_trim(value)

    return trimmed if trimmed else None


def _string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}

    return {key: entry for key, entry in value.items() if isinstance(entry, str)}
