"""Markdown pieces a ticket renderer is built from."""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from ._text import js_trim


def section(heading: str, body: str | None) -> str:
    """Markdown section, omitted entirely when it has no body."""
    trimmed = js_trim(body) if body is not None else ""

    return f"## {heading}\n\n{trimmed}" if trimmed else ""


def bullets(heading: str, items: Sequence[str]) -> str:
    """A markdown bullet list, omitted entirely when nothing is listed."""
    if len(items) == 0:
        return ""

    listed = "\n".join(f"- {item}" for item in items)

    return f"## {heading}\n\n{listed}"


def labelled(label: str, value: str | None) -> str | None:
    """
    One `**Label:** value` line, or nothing when the value is absent.

    Returns `None` rather than an empty string so a list of these narrows to the
    lines that have a value: `[line for line in facts if line is not None]`.
    """
    return f"**{label}:** {value}" if value else None


def compose(sections: Iterable[str]) -> str:
    """Joins sections, dropping the empty ones so no heading stands alone."""
    return "\n\n".join(part for part in sections if len(part) > 0)
