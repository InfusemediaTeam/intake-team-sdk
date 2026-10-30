"""
A team's output is held to the output schemas `tools/list` publishes before it
leaves, so what the host's client would reject arrives as the contract's
`INTERNAL` error instead. Every call below goes through a real client that has
listed the tools, as a host does, and would itself raise on a result that fails
its schema.
"""

from __future__ import annotations

import contextlib
import io
import unittest
from typing import Any

from support import connect, error_of

from example_team import DESCRIPTOR, READY_DRAFT, create_args, minimal_team
from intake_team_sdk import (
    CREATE_TASK_TOOL,
    GET_TASK_STATUS_TOOL,
    GET_TEAM_DESCRIPTOR_TOOL,
    RENDER_TICKET_TOOL,
    VALIDATE_DEFINITION_OF_READY_TOOL,
    TeamDefinition,
    create_team_server,
)

REFERENCE: dict[str, Any] = {
    "id": "task-1",
    "displayKey": "EX-1",
    "url": "https://tasks.example.test/EX-1",
    "location": "Example queue",
}

STATUS: dict[str, Any] = {
    "taskId": "task-1",
    "category": "todo",
    "label": "Open",
    "assignee": None,
    "lastChangedAt": None,
}


async def call(definition: TeamDefinition, name: str, args: dict[str, Any]) -> Any:
    # The failure's details go to stderr, which is not what is under test.
    with contextlib.redirect_stderr(io.StringIO()):
        async with connect(definition) as client:
            return await client.call_tool(name, args)


async def created(task: dict[str, Any]) -> Any:
    async def create_task(_input: Any, _context: Any) -> Any:
        return {"task": task}

    return await call(minimal_team(create_task=create_task), CREATE_TASK_TOOL, create_args())


async def statuses(entries: list[dict[str, Any]]) -> Any:
    async def get_task_status(_ids: Any, _context: Any) -> Any:
        return {"statuses": entries}

    return await call(
        minimal_team(get_task_status=get_task_status),
        GET_TASK_STATUS_TOOL,
        {"taskIds": ["task-1"]},
    )


def with_descriptor(**overrides: Any) -> TeamDefinition:
    return minimal_team(descriptor={**DESCRIPTOR, **overrides})


class OutputSchemaTest(unittest.IsolatedAsyncioTestCase):
    def assert_internal(self, result: Any) -> None:
        self.assertTrue(result.isError)
        self.assertIsNone(result.structuredContent)
        self.assertEqual(error_of(result)["code"], "INTERNAL")

    async def test_passes_output_at_the_schema_limits_through_unchanged(self) -> None:
        rendered = {"description": "d" * 30000, "summary": "s" * 500}
        task = {**REFERENCE, "displayKey": "K" * 64}
        status = {**STATUS, "label": "L" * 100}

        render = await call(
            minimal_team(render=lambda _draft: rendered), RENDER_TICKET_TOOL, {"draft": READY_DRAFT}
        )
        creation = await created(task)
        read = await statuses([status])

        self.assertFalse(render.isError)
        self.assertEqual(render.structuredContent, rendered)
        self.assertEqual(creation.structuredContent, {"task": task})
        self.assertEqual(read.structuredContent, {"statuses": [status]})

    async def test_reports_an_invalid_render_result_as_internal(self) -> None:
        for label, rendered in [
            ("an overlong description", {"description": "d" * 30001}),
            ("an empty description", {"description": ""}),
            ("an overlong summary", {"description": "ok", "summary": "s" * 501}),
            ("no description", {}),
        ]:
            with self.subTest(label):
                definition = minimal_team(render=lambda _draft, value=rendered: value)

                self.assert_internal(
                    await call(definition, RENDER_TICKET_TOOL, {"draft": READY_DRAFT})
                )

    async def test_reports_an_invalid_readiness_verdict_as_internal(self) -> None:
        issue = {"field": "title", "message": "Needs a title."}

        for label, verdict in [
            (
                "more blockers than the schema allows",
                {"ready": False, "blockers": [issue] * 26, "warnings": []},
            ),
            (
                "an overlong warning",
                {"ready": True, "blockers": [], "warnings": [{"message": "w" * 501}]},
            ),
        ]:
            with self.subTest(label):
                definition = minimal_team(validate=lambda _draft, value=verdict: value)

                self.assert_internal(
                    await call(
                        definition, VALIDATE_DEFINITION_OF_READY_TOOL, {"draft": READY_DRAFT}
                    )
                )

    async def test_reports_an_invalid_task_reference_as_internal(self) -> None:
        for label, task in [
            ("an overlong id", {**REFERENCE, "id": "i" * 257}),
            ("an overlong displayKey", {**REFERENCE, "displayKey": "K" * 65}),
            ("an overlong url", {**REFERENCE, "url": "https://x.test/" + "p" * 2048}),
            ("an overlong location", {**REFERENCE, "location": "l" * 501}),
            ("a url that is not http(s)", {**REFERENCE, "url": "ftp://x.test"}),
        ]:
            with self.subTest(label):
                self.assert_internal(await created(task))

    async def test_drops_a_status_with_an_invalid_field_as_any_malformed_status_is(
        self,
    ) -> None:
        for label, status in [
            ("an overlong label", {**STATUS, "label": "L" * 101}),
            ("an overlong assignee", {**STATUS, "assignee": "a" * 201}),
            ("an overlong lastChangedAt", {**STATUS, "lastChangedAt": "t" * 65}),
        ]:
            with self.subTest(label):
                result = await statuses([status, STATUS])

                self.assertEqual(result.structuredContent, {"statuses": [STATUS]})

    async def test_reports_more_statuses_than_the_schema_allows_as_internal(self) -> None:
        self.assert_internal(await statuses([STATUS] * 51))

    async def test_reports_a_descriptor_changed_after_startup_as_internal(self) -> None:
        fields = list(DESCRIPTOR["fields"])
        definition = with_descriptor(fields=fields)

        with contextlib.redirect_stderr(io.StringIO()):
            async with connect(definition) as client:
                fields.extend(fields * 25)

                self.assert_internal(await client.call_tool(GET_TEAM_DESCRIPTOR_TOOL, {}))


class DescriptorAtStartupTest(unittest.TestCase):
    def test_refuses_to_build_a_server_for_a_descriptor_its_schema_rejects(self) -> None:
        for label, overrides in [
            ("more fields than the schema allows", {"fields": DESCRIPTOR["fields"] * 26}),
            ("an overlong readiness note", {"readinessNotes": ["n" * 501]}),
            ("a team key the schema rejects", {"team": {**DESCRIPTOR["team"], "key": "lower"}}),
            ("another contract major version", {"contractVersion": "1.0"}),
        ]:
            with self.subTest(label):
                with self.assertRaisesRegex(
                    ValueError,
                    "intake_get_team_descriptor result does not match its output schema",
                ):
                    create_team_server(with_descriptor(**overrides))


if __name__ == "__main__":
    unittest.main()
