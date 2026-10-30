"""
Reading a team server's configuration out of the environment: a required value,
a required list, a list of `left=right` pairs, and the service-token settings.
"""

from __future__ import annotations

import os
from collections.abc import Callable

from ._text import js_trim
from .service_token import ServiceTokenOptions

# Separates entries in a list-valued variable, e.g. `intake,triage`.
_LIST_SEPARATOR = ","

# Separates a pair's two sides, e.g. `priority=P2`.
_PAIR_SEPARATOR = "="


def required_env(name: str) -> str:
    """
    A configured, non-blank value.

    The variable is named in the failure because the alternative, a boot that
    dies on a `KeyError` or a `None` somewhere later, says nothing about which
    of a deployment's settings is missing.

    Raises `ValueError` if the variable is absent or blank.
    """
    raw = os.environ.get(name)

    if raw is None or len(js_trim(raw)) == 0:
        raise ValueError(f"{name} is required and must not be blank")

    return js_trim(raw)


def required_env_list(name: str) -> tuple[str, ...]:
    """
    A required comma-separated list, with at least one entry.

    Raises `ValueError` if the variable is absent, blank, or lists nothing.
    """
    entries = _split_list(required_env(name))

    if len(entries) == 0:
        raise ValueError(f"{name} must list at least one value")

    return entries


def read_pairs(
    name: str, raw: str, shape: str, check: Callable[[str, str], None]
) -> dict[str, str]:
    """
    A comma-separated list of `left=right` pairs, split on the first `=` and
    trimmed, with `check` judging each pair before it is kept.

    Raises `ValueError` if an entry has no separator or a left-hand side is
    listed twice; whatever `check` raises is passed through.
    """
    pairs: dict[str, str] = {}

    for entry in _split_list(raw):
        left, separator, right = entry.partition(_PAIR_SEPARATOR)

        if not separator:
            raise ValueError(f'{name} entry "{entry}" must be {shape}')

        left = js_trim(left)
        right = js_trim(right)

        check(left, right)

        # Refused rather than last-wins: a repeated entry is a mistake in the
        # deployment, and silently keeping one of the two puts whichever was
        # not meant onto every task this team creates.
        if left in pairs:
            raise ValueError(f"{name} lists {left} more than once")

        pairs[left] = right

    return pairs


def service_auth_from_env(prefix: str) -> ServiceTokenOptions:
    """
    A team server's service-token settings, read from `<PREFIX>_MCP_JWT_*`.

    | Variable                     | Shape                                        |
    | ---------------------------- | -------------------------------------------- |
    | `<PREFIX>_MCP_JWT_SECRET`    | At least 32 characters, shared with the host |
    | `<PREFIX>_MCP_JWT_ISSUER`    | The host's name, e.g. `example-host`         |
    | `<PREFIX>_MCP_JWT_AUDIENCE`  | This server's name as the host addresses it  |

    Call it at startup, so a missing value stops the server rather than leaving
    it up and refusing every request.

    Raises `ValueError` if a variable is absent or blank.
    """
    return ServiceTokenOptions(
        secret=required_env(f"{prefix}_MCP_JWT_SECRET"),
        issuer=required_env(f"{prefix}_MCP_JWT_ISSUER"),
        audience=required_env(f"{prefix}_MCP_JWT_AUDIENCE"),
    )


def _split_list(raw: str) -> tuple[str, ...]:
    """Blank entries dropped, so a trailing comma is not a nameless label."""
    entries = (js_trim(entry) for entry in raw.split(_LIST_SEPARATOR))

    return tuple(entry for entry in entries if len(entry) > 0)
