"""
String rules as JavaScript applies them.

The JavaScript SDK is the reference: a value one SDK calls blank, or too long,
must be judged the same way by the other, or a host would see a draft change
readiness depending on which language its department server is written in.
"""

from __future__ import annotations

# ECMAScript WhiteSpace and LineTerminator: what `String.prototype.trim` strips.
# `str.strip()` differs at the edges, e.g. it keeps U+FEFF and strips U+001C.
_JS_WHITESPACE = (
    "\t\n\v\f\r          "
    "        　﻿"
)


def js_trim(value: str) -> str:
    return value.strip(_JS_WHITESPACE)


def js_length(value: str) -> int:
    """UTF-16 code units, as `.length` counts them: an emoji counts twice."""
    return len(value.encode("utf-16-le", "surrogatepass")) // 2


def non_blank(value: object) -> bool:
    return isinstance(value, str) and len(js_trim(value)) > 0
