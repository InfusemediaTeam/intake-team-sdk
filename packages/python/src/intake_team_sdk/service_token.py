"""
Short-lived HS256 tokens a host sends a department server over HTTP.

HS256 with one secret per department: a department can verify only tokens
meant for it, and neither side needs a JWT library. The checks are the
contract's, in `spec/contract.json`, and run in the same order as the
JavaScript SDK's, so both judge every token in `spec/fixtures/` the same way.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import math
import re
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from ._generated import SERVICE_TOKEN_RULES
from ._text import js_length

_ALGORITHM: str = SERVICE_TOKEN_RULES["algorithm"]
_MIN_SECRET_LENGTH: int = SERVICE_TOKEN_RULES["minSecretLength"]
_MAX_LIFETIME_SECONDS: int = SERVICE_TOKEN_RULES["maxLifetimeSeconds"]
_CLOCK_TOLERANCE_SECONDS: int = SERVICE_TOKEN_RULES["clockToleranceSeconds"]

_HEADER = {"alg": _ALGORITHM, "typ": "JWT"}

_MILLISECONDS_PER_SECOND = 1000

_TASK_IDS_DIGEST = re.compile(r"[A-Za-z0-9_-]{43}")
"""A base64url SHA-256 digest: 32 bytes, unpadded."""


@dataclass(frozen=True)
class ServiceTokenOptions:
    """What a server needs to accept a token."""

    secret: str
    """At least 32 characters, shared with the host for this department only."""
    issuer: str
    """The host's name, e.g. `example-host`."""
    audience: str
    """This server's own name, as the host addresses it."""


@dataclass(frozen=True)
class ServiceCaller:
    """A verified caller, as a tool handler sees it."""

    issuer: str
    subject: str | None
    """The requester's `userId`, when the host is acting for one."""
    task_ids_digest: str | None
    """
    The task ids the host found owned by `subject`, as `task_ids_digest()` of
    the exact list it sends; `None` when the token covers no status read.
    """
    scopes: tuple[str, ...]
    token_id: str
    expires_at: int
    """Epoch seconds."""


class ServiceTokenError(Exception):
    """A token the server refuses. The message is safe to log, never the token."""


def assert_service_secret(secret: str) -> None:
    """Raises `ValueError` if the secret is shorter than the contract allows."""
    if js_length(secret) < _MIN_SECRET_LENGTH:
        raise ValueError(
            f"A service token secret must be at least {_MIN_SECRET_LENGTH} characters"
        )


def sign_service_token(
    *,
    secret: str,
    issuer: str,
    audience: str,
    scopes: Sequence[str],
    lifetime_seconds: int,
    subject: str | None = None,
    task_ids: Sequence[str] | None = None,
    now_ms: int | None = None,
) -> str:
    """
    Signs one token. For hosts and tests; a department server only verifies.

    `task_ids` is the exact list a status call sends, already checked owned by
    `subject`. `now_ms` is epoch milliseconds, injectable so a test can pin
    the clock.
    """
    assert_service_secret(secret)

    if lifetime_seconds <= 0 or lifetime_seconds > _MAX_LIFETIME_SECONDS:
        raise ValueError(
            f"A service token lives between 1 and {_MAX_LIFETIME_SECONDS} seconds"
        )

    issued_at = _seconds(_now_ms() if now_ms is None else now_ms)
    claims: dict[str, Any] = {"iss": issuer, "aud": audience}

    if subject is not None:
        claims["sub"] = subject

    if task_ids is not None:
        claims["task_ids_sha256"] = task_ids_digest(task_ids)

    claims.update(
        {
            "scope": " ".join(scopes),
            "iat": issued_at,
            "exp": issued_at + lifetime_seconds,
            "jti": str(uuid.uuid4()),
        }
    )

    signing_input = f"{_encode(_HEADER)}.{_encode(claims)}"

    return f"{signing_input}.{_signature(signing_input, secret)}"


def verify_service_token(
    token: str, options: ServiceTokenOptions, now_ms: int | None = None
) -> ServiceCaller:
    """
    The caller a token proves, or a `ServiceTokenError`.

    Checked: the HS256 signature, issuer, audience, expiry and issue time with
    the contract's clock tolerance, and a lifetime no longer than the
    contract's maximum, so a leaked long-lived token is refused even when
    correctly signed.

    `now_ms` is epoch milliseconds, injectable so a test can pin the clock.
    """
    parts = token.split(".")

    if len(parts) != 3:
        raise ServiceTokenError("Malformed token")

    encoded_header, encoded_claims, presented = parts
    header = _decode(encoded_header)

    # Pinned rather than read from the token: trusting its own `alg` is how
    # `none` and algorithm-confusion attacks get in.
    if header.get("alg") != _ALGORITHM:
        raise ServiceTokenError("Unsupported token algorithm")

    expected = _signature(f"{encoded_header}.{encoded_claims}", options.secret)

    if not _same_text(presented, expected):
        raise ServiceTokenError("Invalid token signature")

    claims = _decode(encoded_claims)
    seconds = _seconds(_now_ms() if now_ms is None else now_ms)
    tolerance = _CLOCK_TOLERANCE_SECONDS

    if not _same_value(claims.get("iss"), options.issuer):
        raise ServiceTokenError("Unexpected token issuer")

    if not _same_value(claims.get("aud"), options.audience):
        raise ServiceTokenError("Unexpected token audience")

    issued_at = _integer(claims.get("iat"), "iat")
    expires_at = _integer(claims.get("exp"), "exp")

    if expires_at + tolerance <= seconds:
        raise ServiceTokenError("Token expired")

    if issued_at - tolerance > seconds:
        raise ServiceTokenError("Token issued in the future")

    if expires_at <= issued_at or expires_at - issued_at > _MAX_LIFETIME_SECONDS:
        raise ServiceTokenError("Token lifetime out of range")

    token_id = claims.get("jti")

    if not isinstance(token_id, str) or len(token_id) == 0:
        raise ServiceTokenError("Token has no id")

    scope = claims.get("scope")

    if not isinstance(scope, str):
        raise ServiceTokenError("Token has no scope")

    subject = claims.get("sub")

    if "sub" in claims and (not isinstance(subject, str) or len(subject) == 0):
        raise ServiceTokenError("Malformed token subject")

    digest = claims.get("task_ids_sha256")

    if "task_ids_sha256" in claims and (
        not isinstance(digest, str) or _TASK_IDS_DIGEST.fullmatch(digest) is None
    ):
        raise ServiceTokenError("Malformed token task binding")

    return ServiceCaller(
        issuer=options.issuer,
        subject=subject if isinstance(subject, str) else None,
        task_ids_digest=digest if isinstance(digest, str) else None,
        scopes=tuple(entry for entry in scope.split(" ") if len(entry) > 0),
        token_id=token_id,
        expires_at=expires_at,
    )


def task_ids_digest(task_ids: Sequence[str]) -> str:
    """
    What `task_ids_sha256` binds: the base64url SHA-256 of `task_ids` as
    compact JSON, in the order sent, byte for byte what the JavaScript SDK
    hashes. A status call is answered only when its own `taskIds` hash to the
    token's, so a token reads exactly the tasks the host checked against its
    own records, and never an id added later.

    Raises `ValueError` for a string that has no UTF-8 form (a lone surrogate),
    which no JavaScript host can have signed.
    """
    raw = json.dumps(list(task_ids), separators=(",", ":"), ensure_ascii=False)

    try:
        encoded = raw.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError("Task ids must be valid Unicode") from error

    return _base64url(hashlib.sha256(encoded).digest())


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


def _seconds(now_ms: float) -> int:
    return math.floor(now_ms / _MILLISECONDS_PER_SECOND)


def _encode(value: dict[str, Any]) -> str:
    text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)

    return _base64url(text.encode("utf-8"))


def _decode(segment: str) -> dict[str, Any]:
    try:
        raw = base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))
        parsed = json.loads(raw.decode("utf-8"), parse_constant=_refuse_constant)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise ServiceTokenError("Malformed token") from None

    if not isinstance(parsed, dict):
        raise ServiceTokenError("Malformed token")

    return parsed


def _refuse_constant(name: str) -> Any:
    """`NaN` and `Infinity` are not JSON, and JavaScript's parser refuses them."""
    raise ValueError(f"Unexpected {name}")


def _signature(signing_input: str, secret: str) -> str:
    digest = hmac.new(
        secret.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256
    ).digest()

    return _base64url(digest)


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _integer(value: Any, claim: str) -> int:
    """A JSON number with no fraction, as `Number.isInteger` judges one."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ServiceTokenError(f"Token {claim} must be an integer")

    if isinstance(value, float) and not (math.isfinite(value) and value.is_integer()):
        raise ServiceTokenError(f"Token {claim} must be an integer")

    return int(value)


def _same_value(claim: Any, expected: str) -> bool:
    """Strict equality: a claim of another JSON type never matches a string."""
    return isinstance(claim, str) and claim == expected


def _same_text(left: str, right: str) -> bool:
    """Constant-time for equal lengths; a length mismatch reveals nothing secret."""
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))
