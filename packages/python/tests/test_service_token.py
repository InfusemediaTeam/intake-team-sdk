from __future__ import annotations

import base64
import hashlib
import hmac
import json
import unittest

from support import read_spec

from intake_team_sdk import (
    ServiceCaller,
    ServiceTokenError,
    ServiceTokenOptions,
    sign_service_token,
    task_ids_digest,
    verify_service_token,
)

# The same recipes the JavaScript suite verifies, so both SDKs agree on every one.
FIXTURE = read_spec("fixtures/service-tokens.json")

OPTIONS = ServiceTokenOptions(
    secret=FIXTURE["testSigningKey"], issuer=FIXTURE["issuer"], audience=FIXTURE["audience"]
)

SIGNING_KEYS = {name: FIXTURE[name] for name in ("testSigningKey", "otherTestSigningKey")}


# Built with hmac alone, never with sign_service_token, so a signing bug in the
# SDK cannot hide itself by producing the tokens it is tested against.
def encode_segment(value: object) -> str:
    # Non-ASCII left as is, as JSON.stringify writes it, so both suites build the same bytes.
    raw = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()

    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def hmac_signature(signing_input: str, key: str) -> str:
    signature = hmac.new(key.encode(), signing_input.encode(), hashlib.sha256).digest()

    return base64.urlsafe_b64encode(signature).rstrip(b"=").decode()


def case_named(name: str) -> dict:
    return next(case for case in FIXTURE["cases"] if case["name"] == name)


def signing_input_of(case: dict) -> str:
    header = {**FIXTURE["baseHeader"], **case.get("header", {})}
    claims = {**FIXTURE["baseClaims"], **case.get("claims", {})}

    for name in case.get("omitClaims", []):
        del claims[name]

    return f"{encode_segment(header)}.{encode_segment(claims)}"


def build_token(case: dict) -> str:
    """A token made as the case's recipe says: the base, its changes, then its signature."""
    if "rawToken" in case:
        return case["rawToken"]

    signing_input = signing_input_of(case)
    signature = case.get("signature")

    if signature == "empty":
        return f"{signing_input}."
    if signature == "omitted":
        return signing_input
    if signature is not None:
        raise ValueError(f"Unknown signature kind {signature}")

    if "signatureOf" in case:
        donor = signing_input_of(case_named(case["signatureOf"]))

        return f"{signing_input}.{hmac_signature(donor, FIXTURE['testSigningKey'])}"

    key = SIGNING_KEYS[case.get("signingKey", "testSigningKey")]

    return f"{signing_input}.{hmac_signature(signing_input, key)}"


def expected_caller(caller: dict) -> ServiceCaller:
    return ServiceCaller(
        issuer=caller["issuer"],
        subject=caller["subject"],
        task_ids_digest=caller["taskIdsDigest"],
        scopes=tuple(caller["scopes"]),
        token_id=caller["tokenId"],
        expires_at=caller["expiresAt"],
    )


class SharedVectorsTest(unittest.TestCase):
    def test_every_vector_is_judged_as_the_fixture_says(self) -> None:
        self.assertGreater(len(FIXTURE["cases"]), 0)

        for case in FIXTURE["cases"]:
            with self.subTest(case["name"]):
                token = build_token(case)

                if case["valid"]:
                    self.assertEqual(
                        verify_service_token(token, OPTIONS, FIXTURE["now"]),
                        expected_caller(case["caller"]),
                    )
                else:
                    with self.assertRaises(ServiceTokenError):
                        verify_service_token(token, OPTIONS, FIXTURE["now"])

    def test_builds_the_pinned_signature_byte_for_byte(self) -> None:
        pinned = FIXTURE["pinnedSignature"]

        self.assertEqual(build_token(case_named(pinned["case"])).split(".")[2], pinned["signature"])

    def test_never_gives_a_wrong_signature_case_a_signature_the_test_key_would_make(self) -> None:
        wrongly_signed = [
            case
            for case in FIXTURE["cases"]
            if "signatureOf" in case or case.get("signingKey", "testSigningKey") != "testSigningKey"
        ]
        self.assertGreater(len(wrongly_signed), 0)

        for case in wrongly_signed:
            with self.subTest(case["name"]):
                signing_input = signing_input_of(case)

                self.assertNotEqual(
                    build_token(case),
                    f"{signing_input}.{hmac_signature(signing_input, FIXTURE['testSigningKey'])}",
                )


class TaskIdsDigestTest(unittest.TestCase):
    def test_hashes_every_shared_vector_as_the_javascript_sdk_does(self) -> None:
        self.assertGreater(len(FIXTURE["taskIdsDigests"]), 0)

        for case in FIXTURE["taskIdsDigests"]:
            with self.subTest(case["taskIds"]):
                self.assertEqual(task_ids_digest(case["taskIds"]), case["digest"])

    def test_refuses_an_id_with_no_utf8_form(self) -> None:
        with self.assertRaises(ValueError):
            task_ids_digest([chr(0xD800)])

    def test_signing_binds_the_task_ids_it_is_given_and_nothing_otherwise(self) -> None:
        def caller(task_ids: list[str] | None = None) -> ServiceCaller:
            token = sign_service_token(
                secret=FIXTURE["testSigningKey"],
                issuer=FIXTURE["issuer"],
                audience=FIXTURE["audience"],
                scopes=["intake:read"],
                lifetime_seconds=60,
                subject="user-9",
                task_ids=task_ids,
            )

            return verify_service_token(token, OPTIONS)

        self.assertEqual(
            caller(["PROJ-1", "PROJ-2"]).task_ids_digest,
            task_ids_digest(["PROJ-1", "PROJ-2"]),
        )
        self.assertIsNone(caller().task_ids_digest)


def forge(claims: dict, secret: str = FIXTURE["testSigningKey"]) -> str:
    """A token with arbitrary claims, signed correctly, for checks the recipes leave out."""
    signing_input = f"{encode_segment(FIXTURE['baseHeader'])}.{encode_segment(claims)}"

    return f"{signing_input}.{hmac_signature(signing_input, secret)}"


NOW_SECONDS = FIXTURE["now"] // 1000

BASE_CLAIMS = {
    "iss": FIXTURE["issuer"],
    "aud": FIXTURE["audience"],
    "scope": "intake:read",
    "iat": NOW_SECONDS - 10,
    "exp": NOW_SECONDS + 50,
    "jti": "token-1",
}


class JavaScriptParityTest(unittest.TestCase):
    """Edge cases where Python's types differ from JavaScript's and must not leak through."""

    def verify(self, **overrides: object) -> ServiceCaller:
        claims = {**BASE_CLAIMS, **overrides}

        return verify_service_token(forge(claims), OPTIONS, FIXTURE["now"])

    def test_accepts_an_integral_float_as_javascript_does(self) -> None:
        self.assertEqual(self.verify(exp=float(NOW_SECONDS + 50)).expires_at, NOW_SECONDS + 50)

    def test_refuses_a_boolean_or_fractional_time(self) -> None:
        for value in (True, NOW_SECONDS + 0.5, "1800000050"):
            with self.subTest(value=value):
                with self.assertRaises(ServiceTokenError):
                    self.verify(exp=value)

    def test_refuses_a_null_subject(self) -> None:
        with self.assertRaises(ServiceTokenError):
            self.verify(sub=None)

    def test_refuses_an_issuer_of_another_type(self) -> None:
        with self.assertRaises(ServiceTokenError):
            self.verify(iss=["example-host"])

    def test_splits_scopes_on_single_spaces_only(self) -> None:
        self.assertEqual(
            self.verify(scope=" intake:read  intake:create ").scopes,
            ("intake:read", "intake:create"),
        )


class SignTest(unittest.TestCase):
    def test_signs_a_token_verify_accepts(self) -> None:
        token = sign_service_token(
            secret=OPTIONS.secret,
            issuer=OPTIONS.issuer,
            audience=OPTIONS.audience,
            scopes=["intake:read", "intake:create"],
            subject="user-9",
            lifetime_seconds=60,
        )

        caller = verify_service_token(token, OPTIONS)

        self.assertEqual(caller.subject, "user-9")
        self.assertEqual(caller.scopes, ("intake:read", "intake:create"))

    def test_omits_the_subject_when_none_is_given(self) -> None:
        token = sign_service_token(
            secret=OPTIONS.secret,
            issuer=OPTIONS.issuer,
            audience=OPTIONS.audience,
            scopes=["intake:read"],
            lifetime_seconds=60,
            now_ms=FIXTURE["now"],
        )
        segment = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))

        self.assertNotIn("sub", claims)
        self.assertEqual(list(claims), ["iss", "aud", "scope", "iat", "exp", "jti"])
        self.assertEqual(claims["exp"] - claims["iat"], 60)
        self.assertIsNone(verify_service_token(token, OPTIONS, FIXTURE["now"]).subject)

    def test_gives_every_token_its_own_id(self) -> None:
        def token() -> str:
            return sign_service_token(
                secret=OPTIONS.secret,
                issuer=OPTIONS.issuer,
                audience=OPTIONS.audience,
                scopes=["intake:read"],
                lifetime_seconds=60,
            )

        self.assertNotEqual(
            verify_service_token(token(), OPTIONS).token_id,
            verify_service_token(token(), OPTIONS).token_id,
        )

    def test_refuses_a_short_secret(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least 32 characters"):
            sign_service_token(
                secret="short",
                issuer=OPTIONS.issuer,
                audience=OPTIONS.audience,
                scopes=[],
                lifetime_seconds=60,
            )

    def test_refuses_a_lifetime_outside_the_contract(self) -> None:
        for lifetime in (0, 301):
            with self.subTest(lifetime=lifetime):
                with self.assertRaisesRegex(ValueError, "between 1 and 300 seconds"):
                    sign_service_token(
                        secret=OPTIONS.secret,
                        issuer=OPTIONS.issuer,
                        audience=OPTIONS.audience,
                        scopes=[],
                        lifetime_seconds=lifetime,
                    )


if __name__ == "__main__":
    unittest.main()
