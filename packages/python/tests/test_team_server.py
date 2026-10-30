from __future__ import annotations

import json
import unittest
from dataclasses import replace
from typing import Any

from support import SPEC, connect, error_of

from example_team import EXAMPLE_DRAFT, EXAMPLE_TEAM, EXAMPLE_TOOL, minimal_team
from intake_team_sdk import (
    CONTRACT_TOOL_NAMES,
    CREATE_TASK_TOOL,
    GET_TEAM_DESCRIPTOR_TOOL,
    RENDER_TICKET_TOOL,
    TOOL_CONTRACTS,
    VALIDATE_DEFINITION_OF_READY_TOOL,
    TeamTool,
    create_team_server,
)
from intake_team_sdk._generated import SDK_VERSION


class ToolListTest(unittest.IsolatedAsyncioTestCase):
    async def test_publishes_required_tools_and_status_only_when_offered(self) -> None:
        async with connect(minimal_team()) as minimal, connect(EXAMPLE_TEAM) as full:
            minimal_names = sorted(tool.name for tool in (await minimal.list_tools()).tools)
            full_names = sorted(tool.name for tool in (await full.list_tools()).tools)

        self.assertEqual(
            minimal_names,
            sorted(
                [
                    CREATE_TASK_TOOL,
                    GET_TEAM_DESCRIPTOR_TOOL,
                    RENDER_TICKET_TOOL,
                    VALIDATE_DEFINITION_OF_READY_TOOL,
                ]
            ),
        )
        self.assertEqual(full_names, sorted([*CONTRACT_TOOL_NAMES, "example_reference"]))

    async def test_publishes_contract_tools_exactly_as_generated_then_team_tools(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            tools = (await client.list_tools()).tools

        self.assertEqual(
            [tool.name for tool in tools],
            [*(contract["name"] for contract in TOOL_CONTRACTS), "example_reference"],
        )

        for tool, contract in zip(tools, TOOL_CONTRACTS):
            with self.subTest(tool=tool.name):
                self.assertEqual(tool.title, contract["title"])
                self.assertEqual(tool.description, contract["description"])
                self.assertEqual(tool.inputSchema, contract["inputSchema"])
                self.assertEqual(tool.outputSchema, contract["outputSchema"])
                expected = (
                    {"readOnlyHint": True}
                    if contract["readOnly"]
                    else {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True}
                )
                assert tool.annotations is not None
                self.assertEqual(tool.annotations.model_dump(exclude_none=True), expected)

        team_tool = tools[-1]
        self.assertEqual(team_tool.inputSchema, {"type": "object", "properties": {}})
        self.assertIsNone(team_tool.outputSchema)
        assert team_tool.annotations is not None
        self.assertEqual(
            team_tool.annotations.model_dump(exclude_none=True), {"readOnlyHint": True}
        )

    async def test_marks_only_creation_as_not_read_only(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            tools = (await client.list_tools()).tools

        for tool in tools:
            assert tool.annotations is not None
            self.assertEqual(
                tool.annotations.readOnlyHint, tool.name != CREATE_TASK_TOOL, tool.name
            )

    async def test_names_the_server_after_the_team(self) -> None:
        server = create_team_server(EXAMPLE_TEAM)

        self.assertEqual(server.name, "intake-example")

    async def test_reports_the_package_json_version_both_sdks_are_generated_from(self) -> None:
        version = json.loads((SPEC.parent / "package.json").read_text(encoding="utf-8"))["version"]

        self.assertEqual(create_team_server(EXAMPLE_TEAM).version, version)
        self.assertEqual(SDK_VERSION, version)


class DispatchTest(unittest.IsolatedAsyncioTestCase):
    async def test_returns_descriptor_as_structured_content_and_same_json_text(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            result = await client.call_tool(GET_TEAM_DESCRIPTOR_TOOL, {})

        assert result.structuredContent is not None
        self.assertFalse(result.isError)
        self.assertEqual(result.structuredContent["team"]["key"], "EXAMPLE")
        self.assertEqual(json.loads(result.content[0].text), result.structuredContent)

    async def test_routes_a_draft_to_the_readiness_check(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            result = await client.call_tool(
                VALIDATE_DEFINITION_OF_READY_TOOL, {"draft": EXAMPLE_DRAFT}
            )

        verdict = result.structuredContent
        assert verdict is not None
        self.assertFalse(verdict["ready"])
        self.assertIn("exampleField", [issue.get("field") for issue in verdict["blockers"]])

    async def test_routes_a_draft_to_the_renderer(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            result = await client.call_tool(RENDER_TICKET_TOOL, {"draft": EXAMPLE_DRAFT})

        assert result.structuredContent is not None
        self.assertTrue(result.structuredContent["description"].startswith("## "))

    async def test_routes_to_a_team_tool(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            result = await client.call_tool("example_reference", {})

        self.assertIn("reference text", result.content[0].text)
        self.assertIsNone(result.structuredContent)

    async def test_awaits_an_async_team_tool(self) -> None:
        async def execute(args: Any) -> str:
            return f"echo {args.get('word')}"

        team = replace(
            EXAMPLE_TEAM,
            tools=(replace(EXAMPLE_TOOL, name="echo", execute=execute),),
        )

        async with connect(team) as client:
            result = await client.call_tool("echo", {"word": "hi"})

        self.assertEqual(result.content[0].text, "echo hi")

    async def test_reports_an_unknown_tool_as_a_contract_error(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            result = await client.call_tool("no_such_tool", {})

        self.assertTrue(result.isError)
        self.assertEqual(error_of(result)["code"], "INVALID_INPUT")

    async def test_does_not_raise_on_a_malformed_draft(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            result = await client.call_tool(
                VALIDATE_DEFINITION_OF_READY_TOOL, {"draft": "not an object"}
            )

        assert result.structuredContent is not None
        self.assertFalse(result.isError)
        self.assertFalse(result.structuredContent["ready"])


class ToolNameValidationTest(unittest.TestCase):
    def _with_tools(self, *names: str) -> Any:
        return replace(
            EXAMPLE_TEAM, tools=tuple(replace(EXAMPLE_TOOL, name=name) for name in names)
        )

    def test_refuses_reserved_names(self) -> None:
        for reserved in [*CONTRACT_TOOL_NAMES, "intake_future_tool"]:
            with self.subTest(reserved), self.assertRaisesRegex(ValueError, "reserves"):
                create_team_server(self._with_tools(reserved))

    def test_refuses_two_tools_sharing_a_name(self) -> None:
        with self.assertRaisesRegex(ValueError, "declared more than once"):
            create_team_server(self._with_tools("duplicate", "duplicate"))

    def test_accepts_distinct_unreserved_names(self) -> None:
        create_team_server(self._with_tools("one", "two"))

    def test_team_tool_is_a_plain_value(self) -> None:
        self.assertIsInstance(EXAMPLE_TOOL, TeamTool)


if __name__ == "__main__":
    unittest.main()
