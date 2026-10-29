"""Draft, readiness, rendering and environment helpers, ported from the JavaScript suites."""

from __future__ import annotations

import os
import unittest
from typing import Any
from unittest import mock

import support  # noqa: F401  (puts src/ on the path)

from intake_team_sdk import (
    EnumFieldMessages,
    ServiceTokenOptions,
    bullets,
    compose,
    draft_prose,
    field_value,
    filled,
    includes_any,
    labelled,
    read_pairs,
    readiness,
    required_env,
    required_env_list,
    section,
    service_auth_from_env,
    to_intake_draft,
)


class ToIntakeDraftTest(unittest.TestCase):
    def test_reads_a_well_formed_payload(self) -> None:
        parsed = to_intake_draft(
            {
                "draft": {
                    "core": {"title": "A title", "whatNeeded": "Some work", "urgency": "ASAP"},
                    "fieldValues": {"exampleField": "A value"},
                    "requester": {"displayName": "Ada", "department": "Research"},
                }
            }
        )

        self.assertEqual(parsed["core"]["title"], "A title")
        self.assertIsNone(parsed["core"]["businessValue"])
        self.assertEqual(parsed["fieldValues"]["exampleField"], "A value")
        self.assertEqual(parsed["requester"]["displayName"], "Ada")

    def test_treats_blank_strings_as_absent(self) -> None:
        self.assertIsNone(to_intake_draft({"draft": {"core": {"title": "   "}}})["core"]["title"])

    def test_trims_core_fields_and_the_requester(self) -> None:
        parsed = to_intake_draft(
            {"draft": {"core": {"title": "  A title  "}, "requester": {"displayName": "  Ada  "}}}
        )

        self.assertEqual(parsed["core"]["title"], "A title")
        self.assertEqual(parsed["requester"]["displayName"], "Ada")

    def test_trims_as_javascript_does(self) -> None:
        # U+FEFF is whitespace to JavaScript's trim and not to str.strip.
        parsed = to_intake_draft({"draft": {"core": {"title": "﻿ x　"}}})

        self.assertEqual(parsed["core"]["title"], "x")
        self.assertFalse(filled("﻿"))

    def test_survives_every_malformed_shape(self) -> None:
        hostile: list[Any] = [None, 42, "text", [], {"draft": 7}, {"draft": {"core": []}}]

        for value in hostile:
            with self.subTest(value=value):
                parsed = to_intake_draft(value)

                self.assertIsNone(parsed["core"]["title"])
                self.assertEqual(parsed["fieldValues"], {})

    def test_drops_field_values_that_are_not_strings(self) -> None:
        parsed = to_intake_draft(
            {"draft": {"fieldValues": {"good": "yes", "bad": {"nested": True}, "worse": 12}}}
        )

        self.assertEqual(parsed["fieldValues"], {"good": "yes"})


class FilledAndFieldValueTest(unittest.TestCase):
    def test_agrees_that_whitespace_is_empty(self) -> None:
        self.assertFalse(filled("  "))
        self.assertFalse(filled(None))
        self.assertTrue(filled("x"))

    def test_trims_a_field_value_and_reports_a_blank_one_as_absent(self) -> None:
        parsed = to_intake_draft({"draft": {"fieldValues": {"a": "  value  ", "b": " "}}})

        self.assertEqual(field_value(parsed, "a"), "value")
        self.assertIsNone(field_value(parsed, "b"))
        self.assertIsNone(field_value(parsed, "missing"))


class DraftProseTest(unittest.TestCase):
    DRAFT = to_intake_draft(
        {
            "draft": {
                "core": {
                    "title": "A TITLE",
                    "whatNeeded": "Some Work",
                    "businessValue": "Saves time",
                    "urgency": "ASAP",
                },
                "fieldValues": {"named": "In a field", "ignored": "Not gathered"},
                "requester": {"displayName": "Ada"},
            }
        }
    )

    def test_gathers_the_prose_core_fields_lower_cased(self) -> None:
        self.assertEqual(draft_prose(self.DRAFT), "a title some work saves time")

    def test_gathers_only_the_field_values_it_was_asked_for(self) -> None:
        text = draft_prose(self.DRAFT, ["named"])

        self.assertIn("in a field", text)
        self.assertNotIn("not gathered", text)

    def test_leaves_out_urgency_and_the_requester(self) -> None:
        text = draft_prose(self.DRAFT, ["named", "ignored"])

        self.assertNotIn("asap", text)
        self.assertNotIn("ada", text)

    def test_skips_absent_fields(self) -> None:
        sparse = to_intake_draft({"draft": {"core": {"title": "Only this"}}})

        self.assertEqual(draft_prose(sparse, ["missing"]), "only this")

    def test_includes_any(self) -> None:
        self.assertTrue(includes_any("a new system for close", ["new system"]))
        self.assertFalse(includes_any("a routine tweak", ["new system"]))
        self.assertFalse(includes_any("anything", []))


def draft(core: dict[str, str] | None = None, field_values: dict[str, str] | None = None) -> Any:
    return to_intake_draft({"draft": {"core": core or {}, "fieldValues": field_values or {}}})


LEVELS = ("Low", "High")

MESSAGES = EnumFieldMessages(missing="State the level.", invalid=lambda value: f'"{value}" is not a level.')


class ReadinessReportTest(unittest.TestCase):
    def test_is_ready_when_nothing_blocks(self) -> None:
        verdict = (
            readiness(draft({"title": "A title"}))
            .require_core("title", "Needs a title.")
            .warn("volume", "Volume would help.")
            .verdict()
        )

        self.assertEqual(
            verdict,
            {
                "ready": True,
                "blockers": [],
                "warnings": [{"field": "volume", "message": "Volume would help."}],
            },
        )

    def test_reports_issues_in_declaration_order(self) -> None:
        verdict = (
            readiness(draft())
            .require_core("title", "Needs a title.")
            .require_field("one", "Needs one.")
            .require_field("two", "Needs two.")
            .verdict()
        )

        self.assertEqual([issue["field"] for issue in verdict["blockers"]], ["title", "one", "two"])
        self.assertFalse(verdict["ready"])

    def test_treats_blank_as_missing_in_core_and_team_fields(self) -> None:
        verdict = (
            readiness(draft({"title": "   "}, {"one": "  "}))
            .require_core("title", "Needs a title.")
            .require_field("one", "Needs one.")
            .verdict()
        )

        self.assertEqual(len(verdict["blockers"]), 2)

    def test_blocks_conditionally(self) -> None:
        blocked = readiness(draft()).block_when(True, "approver", "Name an approver.").verdict()
        clear = readiness(draft()).block_when(False, "approver", "Name an approver.").verdict()

        self.assertEqual(len(blocked["blockers"]), 1)
        self.assertTrue(clear["ready"])

    def test_warns_only_about_a_missing_field(self) -> None:
        present = readiness(draft({}, {"volume": "12"})).warn_missing_field("volume", "V.").verdict()
        absent = readiness(draft()).warn_missing_field("volume", "V.").verdict()

        self.assertEqual(len(present["warnings"]), 0)
        self.assertEqual(len(absent["warnings"]), 1)

    def test_carries_a_message_with_no_field(self) -> None:
        verdict = readiness(draft()).block(None, "This request is out of scope.").verdict()

        self.assertEqual(verdict["blockers"], [{"message": "This request is out of scope."}])

    def test_require_enum_field(self) -> None:
        accepted = readiness(draft({}, {"level": "High"})).require_enum_field("level", LEVELS, MESSAGES)
        missing = readiness(draft()).require_enum_field("level", LEVELS, MESSAGES)
        unknown = readiness(draft({}, {"level": "Medium"})).require_enum_field("level", LEVELS, MESSAGES)

        self.assertTrue(accepted.verdict()["ready"])
        self.assertEqual(
            missing.verdict()["blockers"], [{"field": "level", "message": "State the level."}]
        )
        # One blocker at most, and a different message for a value that needs
        # correcting than for one that needs answering.
        self.assertEqual(
            unknown.verdict()["blockers"],
            [{"field": "level", "message": '"Medium" is not a level.'}],
        )


class RenderHelpersTest(unittest.TestCase):
    def test_omits_a_section_with_no_body(self) -> None:
        self.assertEqual(section("Scope", "The work"), "## Scope\n\nThe work")
        self.assertEqual(section("Scope", None), "")
        self.assertEqual(section("Scope", "   "), "")

    def test_trims_the_body(self) -> None:
        self.assertEqual(section("Scope", "  The work  "), "## Scope\n\nThe work")

    def test_omits_an_empty_bullet_list(self) -> None:
        self.assertEqual(bullets("Facts", ["one", "two"]), "## Facts\n\n- one\n- two")
        self.assertEqual(bullets("Facts", []), "")

    def test_renders_a_labelled_line_only_with_a_value(self) -> None:
        self.assertEqual(labelled("Urgency", "ASAP"), "**Urgency:** ASAP")
        self.assertIsNone(labelled("Urgency", None))
        self.assertIsNone(labelled("Urgency", ""))

    def test_drops_empty_parts_when_composing(self) -> None:
        body = compose([section("A", "one"), section("B", None), "tail"])

        self.assertEqual(body, "## A\n\none\n\ntail")
        self.assertEqual(compose([]), "")
        self.assertEqual(compose(["", ""]), "")


class EnvHelpersTest(unittest.TestCase):
    def test_reads_a_required_value_trimmed_and_names_a_missing_one(self) -> None:
        with mock.patch.dict(os.environ, {"SDK_TEST_VALUE": "  value "}):
            self.assertEqual(required_env("SDK_TEST_VALUE"), "value")

        with mock.patch.dict(os.environ, {"SDK_TEST_VALUE": "   "}):
            with self.assertRaisesRegex(ValueError, "SDK_TEST_VALUE is required"):
                required_env("SDK_TEST_VALUE")

    def test_reads_a_list_and_refuses_an_empty_one(self) -> None:
        with mock.patch.dict(os.environ, {"SDK_TEST_LIST": "a, b,,"}):
            self.assertEqual(required_env_list("SDK_TEST_LIST"), ("a", "b"))

        with mock.patch.dict(os.environ, {"SDK_TEST_LIST": " , "}):
            with self.assertRaisesRegex(ValueError, "must list at least one value"):
                required_env_list("SDK_TEST_LIST")

    def test_reads_pairs_on_the_first_separator_and_refuses_duplicates(self) -> None:
        def accept(_left: str, _right: str) -> None:
            return None

        self.assertEqual(read_pairs("X", "a=1, b=x=y", "k=v", accept), {"a": "1", "b": "x=y"})

        with self.assertRaisesRegex(ValueError, "lists a more than once"):
            read_pairs("X", "a=1,a=2", "k=v", accept)

        with self.assertRaisesRegex(ValueError, "must be k=v"):
            read_pairs("X", "nope", "k=v", accept)

    def test_reads_service_token_settings_by_prefix(self) -> None:
        values = {
            "EXAMPLE_MCP_JWT_SECRET": "s" * 32,
            "EXAMPLE_MCP_JWT_ISSUER": "example-host",
            "EXAMPLE_MCP_JWT_AUDIENCE": "example",
        }

        with mock.patch.dict(os.environ, values):
            self.assertEqual(
                service_auth_from_env("EXAMPLE"),
                ServiceTokenOptions(secret="s" * 32, issuer="example-host", audience="example"),
            )

            del os.environ["EXAMPLE_MCP_JWT_AUDIENCE"]

            with self.assertRaisesRegex(ValueError, "EXAMPLE_MCP_JWT_AUDIENCE is required"):
                service_auth_from_env("EXAMPLE")


if __name__ == "__main__":
    unittest.main()
