from __future__ import annotations

import asyncio
import contextlib
import io
import json
import unittest
from typing import Any

from support import connect, error_of

import anyio
import mcp.types as types

from example_team import ABSENT, EXAMPLE_DRAFT, create_args, example_team, minimal_team
from intake_team_sdk import (
    CREATE_TASK_TOOL,
    IntakeDraft,
    TaskCallContext,
    TaskError,
    TeamDefinition,
    create_team_server,
)


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
            "no idempotency key": create_args(idempotencyKey=ABSENT),
            "a malformed idempotency key": create_args(idempotencyKey="has spaces"),
            "a key with a trailing newline": create_args(idempotencyKey="key\n"),
            "an overlong key": create_args(idempotencyKey="k" * 129),
            "no requester": create_args(requester=ABSENT),
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


class CreationTakeoverTest(unittest.IsolatedAsyncioTestCase):
    """
    The call that owns a creation is cancelled before the team answers.

    Driven through the server's own `tools/call` handler, cancelled as the MCP
    session cancels it when the host sends `notifications/cancelled`.
    """

    async def abandon(self, waiters: int) -> tuple[list[Any], int, int]:
        """
        Starts a creation that stalls until cancelled, lets `waiters` calls with
        the same key join it, then cancels it. Returns each waiting call's
        result, how many creations the team began, and how many tasks exist.
        """
        team = example_team()
        attempts = 0
        validated = 0
        started = asyncio.Event()
        joined = asyncio.Event()

        def validate(draft: IntakeDraft) -> Any:
            nonlocal validated
            validated += 1

            # The last step before a call joins the creation in flight, with
            # no await in between.
            if validated == waiters + 1:
                joined.set()

            return team.validate(draft)

        async def create_task(input: Any, context: TaskCallContext) -> Any:
            nonlocal attempts
            attempts += 1

            if attempts == 1:
                started.set()
                await anyio.sleep_forever()

            return await team.create_task(input, context)

        definition = TeamDefinition(
            descriptor=team.descriptor,
            validate=validate,
            render=team.render,
            create_task=create_task,
        )
        handler = create_team_server(definition).request_handlers[types.CallToolRequest]
        request = types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(name=CREATE_TASK_TOOL, arguments=create_args()),
        )

        owner = asyncio.create_task(handler(request))
        await started.wait()

        waiting = [asyncio.create_task(handler(request)) for _ in range(waiters)]
        await joined.wait()

        owner.cancel()

        with self.assertRaises(asyncio.CancelledError):
            await owner

        results = [result.root for result in await asyncio.gather(*waiting)]

        return results, attempts, len(team.created)

    async def test_lets_a_waiting_retry_take_the_creation_over(self) -> None:
        results, attempts, created = await self.abandon(1)

        self.assertFalse(results[0].isError)
        self.assertEqual(
            results[0].structuredContent,
            {
                "task": {
                    "id": "task-1",
                    "displayKey": "EX-1",
                    "url": "https://tasks.example.test/EX-1",
                    "location": "Example queue",
                }
            },
        )
        self.assertEqual(attempts, 2)
        self.assertEqual(created, 1)

    async def test_takes_over_once_for_every_waiting_call(self) -> None:
        results, attempts, created = await self.abandon(3)

        self.assertEqual(attempts, 2)
        self.assertEqual(created, 1)

        for result in results:
            self.assertFalse(result.isError)
            self.assertEqual(result.structuredContent, results[0].structuredContent)


if __name__ == "__main__":
    unittest.main()
