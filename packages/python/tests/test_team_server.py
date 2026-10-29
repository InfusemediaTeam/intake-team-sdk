from __future__ import annotations

import asyncio
import contextlib
import io
import json
import unittest
from typing import Any

from support import caller_for, connect, error_of

from example_team import (
    EXAMPLE_DRAFT,
    EXAMPLE_TEAM,
    EXAMPLE_TOOL,
    READY_DRAFT,
    example_team,
    minimal_team,
)
from intake_team_sdk import (
    CONTRACT_TOOL_NAMES,
    CREATE_SCOPE,
    CREATE_TASK_TOOL,
    GET_TASK_STATUS_TOOL,
    GET_TEAM_DESCRIPTOR_TOOL,
    READ_SCOPE,
    RENDER_TICKET_TOOL,
    TOOL_CONTRACTS,
    VALIDATE_DEFINITION_OF_READY_TOOL,
    TaskError,
    TeamTool,
    create_team_server,
)
from dataclasses import replace


def create_args(**overrides: Any) -> dict[str, Any]:
    args: dict[str, Any] = {
        "idempotencyKey": "request-1",
        "draft": READY_DRAFT,
        "requester": {"userId": "user-1", "email": "ada@example.test"},
    }
    args.update(overrides)

    return {key: value for key, value in args.items() if value is not _ABSENT}


_ABSENT: Any = object()


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
        self.assertEqual(team_tool.annotations.model_dump(exclude_none=True), {"readOnlyHint": True})

    async def test_marks_only_creation_as_not_read_only(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            tools = (await client.list_tools()).tools

        for tool in tools:
            assert tool.annotations is not None
            self.assertEqual(tool.annotations.readOnlyHint, tool.name != CREATE_TASK_TOOL, tool.name)

    async def test_names_the_server_after_the_team(self) -> None:
        server = create_team_server(EXAMPLE_TEAM)

        self.assertEqual(server.name, "intake-example")
        self.assertEqual(server.version, "2.0.0")


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


class CreateTaskTest(unittest.IsolatedAsyncioTestCase):
    async def test_creates_a_task_and_returns_its_reference(self) -> None:
        team = example_team()

        async with connect(team) as client:
            result = await client.call_tool(CREATE_TASK_TOOL, create_args())

        self.assertFalse(result.isError)
        self.assertEqual(
            result.structuredContent,
            {
                "task": {
                    "id": "task-1",
                    "displayKey": "EX-1",
                    "url": "https://tasks.example.test/EX-1",
                    "location": "Example queue",
                }
            },
        )
        self.assertEqual(json.loads(result.content[0].text), result.structuredContent)
        self.assertEqual(
            team.calls[0]["requester"], {"userId": "user-1", "email": "ada@example.test"}
        )
        self.assertIsNone(team.contexts[0].caller)

    async def test_returns_the_same_task_for_a_retried_key(self) -> None:
        team = example_team()

        async with connect(team) as client:
            first = await client.call_tool(CREATE_TASK_TOOL, create_args())
            second = await client.call_tool(CREATE_TASK_TOOL, create_args())

        self.assertEqual(second.structuredContent, first.structuredContent)
        self.assertEqual(len(team.created), 1)

    async def test_merges_concurrent_calls_with_the_same_key(self) -> None:
        team = example_team()

        async with connect(team) as client:
            results = await asyncio.gather(
                *(client.call_tool(CREATE_TASK_TOOL, create_args()) for _ in range(3))
            )

        self.assertEqual(len(team.calls), 1)

        for result in results:
            self.assertEqual(result.structuredContent, results[0].structuredContent)

    async def test_merges_concurrent_calls_across_server_objects(self) -> None:
        team = example_team()

        async with connect(team) as one, connect(team) as two:
            await asyncio.gather(
                one.call_tool(CREATE_TASK_TOOL, create_args()),
                two.call_tool(CREATE_TASK_TOOL, create_args()),
            )

        self.assertEqual(len(team.calls), 1)

    async def test_does_not_merge_different_requesters_with_the_same_key(self) -> None:
        team = example_team()

        async with connect(team) as client:
            await asyncio.gather(
                client.call_tool(CREATE_TASK_TOOL, create_args()),
                client.call_tool(
                    CREATE_TASK_TOOL, create_args(requester={"userId": "user-2", "email": None})
                ),
            )

        self.assertEqual(len(team.calls), 2)

    async def test_shares_a_failure_with_every_merged_call(self) -> None:
        calls = 0

        async def create_task(_input: Any, _context: Any) -> Any:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.01)

            raise TaskError("DESTINATION_UNAVAILABLE", "Board is down", True)

        async with connect(minimal_team(create_task=create_task)) as client:
            results = await asyncio.gather(
                *(client.call_tool(CREATE_TASK_TOOL, create_args()) for _ in range(3))
            )

        self.assertEqual(calls, 1)

        for result in results:
            self.assertEqual(error_of(result)["code"], "DESTINATION_UNAVAILABLE")

    async def test_refuses_a_draft_that_is_not_ready_without_calling_the_team(self) -> None:
        team = example_team()

        async with connect(team) as client:
            result = await client.call_tool(CREATE_TASK_TOOL, create_args(draft=EXAMPLE_DRAFT))

        self.assertTrue(result.isError)
        self.assertIsNone(result.structuredContent)
        self.assertEqual(
            error_of(result),
            {
                "code": "NOT_READY",
                "message": "The draft does not meet the Definition of Ready",
                "retryable": False,
            },
        )
        self.assertEqual(len(team.calls), 0)

    async def test_refuses_malformed_creation_input(self) -> None:
        cases = {
            "no idempotency key": create_args(idempotencyKey=_ABSENT),
            "a malformed idempotency key": create_args(idempotencyKey="has spaces"),
            "a key with a trailing newline": create_args(idempotencyKey="key\n"),
            "an overlong key": create_args(idempotencyKey="k" * 129),
            "no requester": create_args(requester=_ABSENT),
            "a blank userId": create_args(requester={"userId": "", "email": None}),
            "an overlong userId": create_args(requester={"userId": "u" * 129, "email": None}),
            "a non-string email": create_args(requester={"userId": "user-1", "email": 42}),
            "a missing email": create_args(requester={"userId": "user-1"}),
        }

        for label, args in cases.items():
            with self.subTest(label):
                team = example_team()

                async with connect(team) as client:
                    result = await client.call_tool(CREATE_TASK_TOOL, args)

                self.assertTrue(result.isError)
                self.assertEqual(error_of(result)["code"], "INVALID_INPUT")
                self.assertEqual(len(team.calls), 0)

    async def test_reports_a_task_error_as_is(self) -> None:
        async def create_task(_input: Any, _context: Any) -> Any:
            raise TaskError("DESTINATION_UNAVAILABLE", "Board is down", True)

        async with connect(minimal_team(create_task=create_task)) as client:
            result = await client.call_tool(CREATE_TASK_TOOL, create_args())

        self.assertTrue(result.isError)
        self.assertIsNone(result.structuredContent)
        self.assertEqual(
            json.loads(result.content[0].text),
            {
                "error": {
                    "code": "DESTINATION_UNAVAILABLE",
                    "message": "Board is down",
                    "retryable": True,
                }
            },
        )

    async def test_hides_an_unexpected_error_behind_a_generic_internal_message(self) -> None:
        async def create_task(_input: Any, _context: Any) -> Any:
            raise RuntimeError("password=hunter2")

        stderr = io.StringIO()

        with contextlib.redirect_stderr(stderr):
            async with connect(minimal_team(create_task=create_task)) as client:
                result = await client.call_tool(CREATE_TASK_TOOL, create_args())

        self.assertEqual(
            error_of(result),
            {
                "code": "INTERNAL",
                "message": "The department could not complete the request.",
                "retryable": True,
            },
        )
        self.assertNotIn("hunter2", result.content[0].text)
        self.assertEqual(
            stderr.getvalue(), "intake-example intake_create_task failed: password=hunter2\n"
        )

    async def test_refuses_a_malformed_task_reference(self) -> None:
        async def create_task(_input: Any, _context: Any) -> Any:
            return {
                "task": {
                    "id": "x",
                    "displayKey": "X-1",
                    "url": "javascript:alert(1)",
                    "location": None,
                }
            }

        async with connect(minimal_team(create_task=create_task)) as client:
            result = await client.call_tool(CREATE_TASK_TOOL, create_args())

        self.assertEqual(
            error_of(result),
            {
                "code": "INTERNAL",
                "message": "The department returned a malformed task reference",
                "retryable": False,
            },
        )

    async def test_returns_only_the_contract_fields_of_a_reference(self) -> None:
        async def create_task(_input: Any, _context: Any) -> Any:
            return {
                "task": {
                    "id": "x",
                    "displayKey": "X-1",
                    "url": None,
                    "location": None,
                    "secretInternalField": "leak",
                }
            }

        async with connect(minimal_team(create_task=create_task)) as client:
            result = await client.call_tool(CREATE_TASK_TOOL, create_args())

        self.assertEqual(
            result.structuredContent,
            {"task": {"id": "x", "displayKey": "X-1", "url": None, "location": None}},
        )


class AuthorizationTest(unittest.IsolatedAsyncioTestCase):
    async def test_lets_a_create_scoped_caller_create_for_its_own_subject(self) -> None:
        team = example_team()
        caller = caller_for("user-1", (CREATE_SCOPE,))

        async with connect(team, caller) as client:
            result = await client.call_tool(CREATE_TASK_TOOL, create_args())

        self.assertFalse(result.isError)
        self.assertEqual(team.contexts[0].caller, caller)

    async def test_refuses_a_forged_requester_user_id(self) -> None:
        team = example_team()

        async with connect(team, caller_for("user-1", (CREATE_SCOPE,))) as client:
            result = await client.call_tool(
                CREATE_TASK_TOOL,
                create_args(requester={"userId": "someone-else", "email": None}),
            )

        self.assertEqual(
            error_of(result),
            {
                "code": "FORBIDDEN",
                "message": "The requester does not match the authenticated caller",
                "retryable": False,
            },
        )
        self.assertEqual(len(team.calls), 0)

    async def test_refuses_creation_to_a_token_with_no_subject(self) -> None:
        async with connect(example_team(), caller_for(None, (CREATE_SCOPE,))) as client:
            result = await client.call_tool(CREATE_TASK_TOOL, create_args())

        self.assertEqual(error_of(result)["code"], "FORBIDDEN")

    async def test_refuses_creation_to_a_read_only_token(self) -> None:
        team = example_team()

        async with connect(team, caller_for("user-1", (READ_SCOPE,))) as client:
            result = await client.call_tool(CREATE_TASK_TOOL, create_args())

        self.assertEqual(
            error_of(result),
            {
                "code": "FORBIDDEN",
                "message": "This call needs the intake:create scope",
                "retryable": False,
            },
        )
        self.assertEqual(len(team.calls), 0)

    async def test_refuses_read_tools_to_a_token_without_the_read_scope(self) -> None:
        async with connect(example_team(), caller_for("user-1", (CREATE_SCOPE,))) as client:
            for name, args in [
                (GET_TEAM_DESCRIPTOR_TOOL, {}),
                (VALIDATE_DEFINITION_OF_READY_TOOL, {"draft": READY_DRAFT}),
                (RENDER_TICKET_TOOL, {"draft": READY_DRAFT}),
                (GET_TASK_STATUS_TOOL, {"taskIds": ["task-1"]}),
                ("example_reference", {}),
            ]:
                with self.subTest(name):
                    result = await client.call_tool(name, args)

                    self.assertEqual(
                        error_of(result)["message"], "This call needs the intake:read scope"
                    )


class StatusAuthorizationTest(unittest.IsolatedAsyncioTestCase):
    """A token caller reads exactly the tasks its token was issued for."""

    async def read(self, caller: Any, task_ids: list[str]) -> tuple[Any, list[Any]]:
        asked: list[Any] = []

        async def get_task_status(ids: Any, _context: Any) -> Any:
            asked.append(list(ids))

            return {
                "statuses": [
                    {
                        "taskId": task_id,
                        "category": "todo",
                        "label": "Open",
                        "assignee": None,
                        "lastChangedAt": None,
                    }
                    for task_id in ids
                ]
            }

        async with connect(minimal_team(get_task_status=get_task_status), caller) as client:
            result = await client.call_tool(GET_TASK_STATUS_TOOL, {"taskIds": task_ids})

        return result, asked

    async def test_answers_exactly_the_tasks_the_token_was_issued_for(self) -> None:
        result, asked = await self.read(
            caller_for("user-1", (READ_SCOPE,), ["T-1", "T-2"]), ["T-1", "T-2"]
        )

        self.assertFalse(result.isError)
        self.assertEqual(asked, [["T-1", "T-2"]])

    async def test_refuses_before_the_team_is_asked(self) -> None:
        for label, caller, task_ids in [
            ("a token with no subject", caller_for(None, (READ_SCOPE,), ["T-1"]), ["T-1"]),
            ("a token bound to no tasks", caller_for("user-1", (READ_SCOPE,)), ["T-1"]),
            (
                "an id the token was not issued for",
                caller_for("user-1", (READ_SCOPE,), ["T-1"]),
                ["T-1", "SOMEONE-ELSES-9"],
            ),
            (
                "another set of ids than the token names",
                caller_for("user-1", (READ_SCOPE,), ["T-1"]),
                ["T-2"],
            ),
            (
                "a token without the read scope",
                caller_for("user-1", (CREATE_SCOPE,), ["T-1"]),
                ["T-1"],
            ),
        ]:
            with self.subTest(label):
                result, asked = await self.read(caller, task_ids)

                self.assertEqual(error_of(result)["code"], "FORBIDDEN")
                self.assertEqual(asked, [])


class TaskStatusTest(unittest.IsolatedAsyncioTestCase):
    async def test_reports_known_tasks_and_leaves_out_the_rest(self) -> None:
        async with connect(example_team()) as client:
            await client.call_tool(CREATE_TASK_TOOL, create_args())
            result = await client.call_tool(
                GET_TASK_STATUS_TOOL, {"taskIds": ["task-1", "unknown"]}
            )

        self.assertEqual(
            result.structuredContent,
            {
                "statuses": [
                    {
                        "taskId": "task-1",
                        "category": "todo",
                        "label": "Open",
                        "assignee": None,
                        "lastChangedAt": None,
                    }
                ]
            },
        )

    async def test_drops_unasked_and_malformed_statuses(self) -> None:
        def status(**overrides: Any) -> dict[str, Any]:
            entry: dict[str, Any] = {
                "taskId": "mine",
                "category": "done",
                "label": "Done",
                "assignee": None,
                "lastChangedAt": None,
            }
            entry.update(overrides)

            return entry

        async def get_task_status(_ids: Any, _context: Any) -> Any:
            return {
                "statuses": [
                    status(taskId="other"),
                    status(category="archived"),
                    status(label="  "),
                    status(assignee=7),
                    {key: value for key, value in status().items() if key != "lastChangedAt"},
                    "not a status",
                    status(assignee="Ada"),
                ]
            }

        async with connect(minimal_team(get_task_status=get_task_status)) as client:
            result = await client.call_tool(GET_TASK_STATUS_TOOL, {"taskIds": ["mine"]})

        self.assertEqual(result.structuredContent, {"statuses": [status(assignee="Ada")]})

    async def test_refuses_a_malformed_id_list(self) -> None:
        async with connect(EXAMPLE_TEAM) as client:
            for args in [
                {"taskIds": []},
                {},
                {"taskIds": "task-1"},
                {"taskIds": [""]},
                {"taskIds": [7]},
                {"taskIds": ["t"] * 51},
                {"taskIds": ["t" * 257]},
            ]:
                with self.subTest(args=str(args)[:40]):
                    result = await client.call_tool(GET_TASK_STATUS_TOOL, args)

                    self.assertEqual(
                        error_of(result),
                        {
                            "code": "INVALID_INPUT",
                            "message": "taskIds must list 1 to 50 task ids",
                            "retryable": False,
                        },
                    )

    async def test_treats_status_as_unknown_for_a_team_without_it(self) -> None:
        async with connect(minimal_team()) as client:
            result = await client.call_tool(GET_TASK_STATUS_TOOL, {"taskIds": ["task-1"]})

        self.assertEqual(
            error_of(result),
            {
                "code": "INVALID_INPUT",
                "message": "Unknown tool: intake_get_task_status",
                "retryable": False,
            },
        )


class ToolNameValidationTest(unittest.TestCase):
    def _with_tools(self, *names: str) -> Any:
        return replace(EXAMPLE_TEAM, tools=tuple(replace(EXAMPLE_TOOL, name=name) for name in names))

    def test_refuses_reserved_names(self) -> None:
        for reserved in [*CONTRACT_TOOL_NAMES, "intake_future_tool"]:
            with self.subTest(reserved):
                with self.assertRaisesRegex(ValueError, "reserves"):
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
