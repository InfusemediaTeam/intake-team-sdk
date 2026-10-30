from __future__ import annotations

import unittest
from dataclasses import replace
from typing import Any

from support import caller_for, connect, error_of

from example_team import EXAMPLE_TOOL, READY_DRAFT, create_args, example_team, minimal_team
from intake_team_sdk import (
    CREATE_SCOPE,
    CREATE_TASK_TOOL,
    GET_TASK_STATUS_TOOL,
    GET_TEAM_DESCRIPTOR_TOOL,
    READ_SCOPE,
    RENDER_TICKET_TOOL,
    TOOL_CONTRACTS,
    VALIDATE_DEFINITION_OF_READY_TOOL,
    TeamDefinition,
)

# Arguments a call to each tool can be answered with.
ARGUMENTS: dict[str, dict[str, Any]] = {
    GET_TEAM_DESCRIPTOR_TOOL: {},
    VALIDATE_DEFINITION_OF_READY_TOOL: {"draft": READY_DRAFT},
    RENDER_TICKET_TOOL: {"draft": READY_DRAFT},
    CREATE_TASK_TOOL: create_args(),
    GET_TASK_STATUS_TOOL: {"taskIds": ["T-1"]},
}


def with_write_tool() -> tuple[TeamDefinition, list[str]]:
    """The example team plus a team tool that changes state, recording each run."""
    executed: list[str] = []

    def execute(_args: Any) -> str:
        executed.append("example_write")

        return "written"

    write_tool = replace(EXAMPLE_TOOL, name="example_write", read_only=False, execute=execute)

    return minimal_team(tools=(EXAMPLE_TOOL, write_tool)), executed


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

    async def test_takes_each_contract_tools_scope_from_spec(self) -> None:
        for contract in TOOL_CONTRACTS:
            with self.subTest(contract["name"]):
                others = tuple(
                    scope for scope in (READ_SCOPE, CREATE_SCOPE) if scope != contract["scope"]
                )

                async with connect(example_team(), caller_for("user-1", others)) as client:
                    result = await client.call_tool(contract["name"], ARGUMENTS[contract["name"]])

                self.assertEqual(
                    error_of(result)["message"], f"This call needs the {contract['scope']} scope"
                )


class TeamToolAuthorizationTest(unittest.IsolatedAsyncioTestCase):
    async def test_lets_a_read_only_token_run_a_read_only_team_tool(self) -> None:
        definition, _executed = with_write_tool()

        async with connect(definition, caller_for("user-1", (READ_SCOPE,))) as client:
            result = await client.call_tool(EXAMPLE_TOOL.name, {})

        self.assertFalse(result.isError)

    async def test_refuses_a_state_changing_team_tool_to_a_read_only_token(self) -> None:
        definition, executed = with_write_tool()

        async with connect(definition, caller_for("user-1", (READ_SCOPE,))) as client:
            result = await client.call_tool("example_write", {})

        self.assertEqual(
            error_of(result),
            {
                "code": "FORBIDDEN",
                "message": "This call needs the intake:create scope",
                "retryable": False,
            },
        )
        self.assertEqual(executed, [])

    async def test_lets_a_create_scoped_token_run_a_state_changing_team_tool(self) -> None:
        definition, executed = with_write_tool()

        async with connect(definition, caller_for("user-1", (CREATE_SCOPE,))) as client:
            result = await client.call_tool("example_write", {})

        self.assertFalse(result.isError)
        self.assertEqual(executed, ["example_write"])

    async def test_runs_every_team_tool_over_stdio_where_there_is_no_token(self) -> None:
        definition, executed = with_write_tool()

        async with connect(definition) as client:
            result = await client.call_tool("example_write", {})

        self.assertFalse(result.isError)
        self.assertEqual(executed, ["example_write"])


class UnknownScopeTest(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_or_malformed_scopes_grant_nothing(self) -> None:
        for scopes in [
            (),
            ("intake:admin",),
            ("INTAKE:READ", "Intake:Create"),
            ("intake:read:all", "intake:"),
            (f"{READ_SCOPE} {CREATE_SCOPE}",),
        ]:
            with self.subTest(scopes=scopes):
                definition, executed = with_write_tool()

                async with connect(definition, caller_for("user-1", scopes)) as client:
                    for name in [
                        GET_TEAM_DESCRIPTOR_TOOL,
                        CREATE_TASK_TOOL,
                        EXAMPLE_TOOL.name,
                        "example_write",
                        "no_such_tool",
                    ]:
                        result = await client.call_tool(name, ARGUMENTS.get(name, {}))

                        self.assertEqual(error_of(result)["code"], "FORBIDDEN", name)

                self.assertEqual(executed, [])

    async def test_unknown_scopes_are_ignored_beside_a_scope_the_call_needs(self) -> None:
        caller = caller_for("user-1", ("intake:admin", READ_SCOPE))

        async with connect(example_team(), caller) as client:
            result = await client.call_tool(GET_TEAM_DESCRIPTOR_TOOL, {})

        self.assertFalse(result.isError)


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


if __name__ == "__main__":
    unittest.main()
