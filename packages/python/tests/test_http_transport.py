"""
The HTTP path end to end: a real listener on an ephemeral port, a real MCP
client over streamable HTTP, and the service-token check in front of both.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import unittest
from collections.abc import AsyncIterator
from typing import Any

from support import error_of

import httpx
import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from example_team import EXAMPLE_TEAM, READY_DRAFT, example_team
from intake_team_sdk import (
    CREATE_TASK_TOOL,
    GET_TASK_STATUS_TOOL,
    GET_TEAM_DESCRIPTOR_TOOL,
    ServiceTokenOptions,
    create_http_app,
    run_http_team_server,
    sign_service_token,
)

AUTH = ServiceTokenOptions(
    secret="http-test-secret-0123456789-abcdefgh", issuer="test-host", audience="example"
)

UNAUTHORIZED_BODY = b'{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null}'


def token(**overrides: Any) -> str:
    request: dict[str, Any] = {
        "secret": AUTH.secret,
        "issuer": AUTH.issuer,
        "audience": AUTH.audience,
        "scopes": ["intake:read"],
        "lifetime_seconds": 60,
    }
    request.update(overrides)

    return sign_service_token(**request)


class _QuietServer(uvicorn.Server):
    """No signal handlers: the test runner owns the process."""

    @contextlib.contextmanager
    def capture_signals(self) -> Any:
        yield


class HttpTransportTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.team = example_team()
        app = create_http_app(self.team, AUTH)
        self.listener = _QuietServer(
            uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="on")
        )
        self.serving = asyncio.create_task(self.listener.serve())

        while not self.listener.started:
            if self.serving.done():
                self.serving.result()

            await asyncio.sleep(0.01)

        port = self.listener.servers[0].sockets[0].getsockname()[1]
        self.base_url = f"http://127.0.0.1:{port}"

    async def asyncTearDown(self) -> None:
        self.listener.should_exit = True
        await self.serving

    @contextlib.asynccontextmanager
    async def client(self, bearer: str) -> AsyncIterator[ClientSession]:
        async with (
            httpx.AsyncClient(headers={"authorization": f"Bearer {bearer}"}) as http,
            streamable_http_client(f"{self.base_url}/mcp", http_client=http) as (read, write, _),
            ClientSession(read, write) as session,
        ):
            await session.initialize()
            await session.list_tools()

            yield session

    async def post(self, headers: dict[str, str], body: bytes) -> httpx.Response:
        async with httpx.AsyncClient() as http:
            return await http.post(
                f"{self.base_url}/mcp",
                headers={"accept": "application/json, text/event-stream", **headers},
                content=body,
            )

    async def test_answers_a_health_check_with_its_team(self) -> None:
        async with httpx.AsyncClient() as http:
            response = await http.get(f"{self.base_url}/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "team": "EXAMPLE"})

    async def test_serves_the_contract_to_an_authorised_client(self) -> None:
        async with self.client(token()) as session:
            result = await session.call_tool(GET_TEAM_DESCRIPTOR_TOOL, {})

        assert result.structuredContent is not None
        self.assertEqual(result.structuredContent["team"]["key"], "EXAMPLE")

    async def test_creates_a_task_for_the_subject_the_token_names(self) -> None:
        async with self.client(token(scopes=["intake:create"], subject="user-1")) as session:
            result = await session.call_tool(
                CREATE_TASK_TOOL,
                {
                    "idempotencyKey": "http-1",
                    "draft": READY_DRAFT,
                    "requester": {"userId": "user-1", "email": None},
                },
            )

        self.assertFalse(result.isError)
        self.assertEqual(self.team.contexts[0].caller.subject, "user-1")
        self.assertEqual(self.team.contexts[0].caller.scopes, ("intake:create",))

    async def test_refuses_a_forged_requester_even_with_a_valid_create_token(self) -> None:
        async with self.client(token(scopes=["intake:create"], subject="user-1")) as session:
            result = await session.call_tool(
                CREATE_TASK_TOOL,
                {
                    "idempotencyKey": "http-2",
                    "draft": READY_DRAFT,
                    "requester": {"userId": "user-2", "email": None},
                },
            )

        self.assertTrue(result.isError)
        self.assertEqual(error_of(result)["code"], "FORBIDDEN")
        self.assertEqual(len(self.team.calls), 0)

    async def test_reads_the_status_only_of_the_tasks_the_token_was_issued_for(self) -> None:
        for bound, allowed in [(["task-1"], True), (["task-2"], False)]:
            with self.subTest(bound=bound):
                async with self.client(token(subject="user-1", task_ids=bound)) as session:
                    result = await session.call_tool(
                        GET_TASK_STATUS_TOOL, {"taskIds": ["task-1"]}
                    )

                if allowed:
                    self.assertFalse(result.isError)
                else:
                    self.assertEqual(error_of(result)["code"], "FORBIDDEN")

    async def test_refuses_creation_to_a_read_only_token(self) -> None:
        async with self.client(token(subject="user-1")) as session:
            result = await session.call_tool(
                CREATE_TASK_TOOL,
                {
                    "idempotencyKey": "http-3",
                    "draft": READY_DRAFT,
                    "requester": {"userId": "user-1", "email": None},
                },
            )

        self.assertEqual(error_of(result)["message"], "This call needs the intake:create scope")

    async def test_gives_each_concurrent_request_its_own_caller(self) -> None:
        async def create(subject: str, index: int) -> Any:
            async with self.client(token(scopes=["intake:create"], subject=subject)) as session:
                return await session.call_tool(
                    CREATE_TASK_TOOL,
                    {
                        "idempotencyKey": f"concurrent-{index}",
                        "draft": READY_DRAFT,
                        "requester": {"userId": subject, "email": None},
                    },
                )

        subjects = [f"user-{index % 3}" for index in range(9)]
        results = await asyncio.gather(
            *(create(subject, index) for index, subject in enumerate(subjects))
        )

        self.assertTrue(all(not result.isError for result in results))
        self.assertEqual(len(self.team.calls), len(subjects))

        for call, context in zip(self.team.calls, self.team.contexts):
            self.assertEqual(context.caller.subject, call["requester"]["userId"])

    async def test_refuses_unauthorized_requests_with_a_json_rpc_error(self) -> None:
        cases = {
            "no header": None,
            "a static bearer token": "Bearer dev-qa-token",
            "another scheme": f"Basic {token()}",
            "a token for another audience": f"Bearer {token(audience='other')}",
            "a token signed with another secret": (
                f"Bearer {token(secret='another-secret-0123456789-abcdefghij')}"
            ),
            "a token with a truncated signature": f"Bearer {token()[:-2]}",
            "an expired token": f"Bearer {token(now_ms=1_000_000_000_000)}",
        }
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode()

        for label, header in cases.items():
            with self.subTest(label):
                headers = {"content-type": "application/json"}

                if header is not None:
                    headers["authorization"] = header

                response = await self.post(headers, body)

                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.content, UNAUTHORIZED_BODY)
                self.assertEqual(
                    response.json(),
                    {
                        "jsonrpc": "2.0",
                        "error": {"code": -32001, "message": "Unauthorized"},
                        "id": None,
                    },
                )

    async def test_checks_the_token_before_reading_the_body(self) -> None:
        response = await self.post({"content-type": "application/json"}, b"{not json")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.content, UNAUTHORIZED_BODY)

    async def test_answers_a_malformed_body_as_json_rpc(self) -> None:
        authorized = {"content-type": "application/json", "authorization": f"Bearer {token()}"}
        malformed = {
            "jsonrpc": "2.0",
            "error": {"code": -32700, "message": "Malformed request"},
            "id": None,
        }

        unreadable = await self.post(authorized, b"{not json")
        too_large = await self.post(authorized, b'{"padding":"' + b"x" * (256 * 1024) + b'"}')

        self.assertEqual((unreadable.status_code, unreadable.json()), (400, malformed))
        self.assertEqual((too_large.status_code, too_large.json()), (413, malformed))


class HttpStartupTest(unittest.IsolatedAsyncioTestCase):
    async def test_refuses_to_start_with_a_short_secret(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least 32 characters"):
            await run_http_team_server(
                EXAMPLE_TEAM,
                0,
                ServiceTokenOptions(secret="short", issuer=AUTH.issuer, audience=AUTH.audience),
            )

    async def test_refuses_to_start_without_an_issuer_or_audience(self) -> None:
        for auth in (
            ServiceTokenOptions(secret=AUTH.secret, issuer=AUTH.issuer, audience=" "),
            ServiceTokenOptions(secret=AUTH.secret, issuer="", audience=AUTH.audience),
        ):
            with self.subTest(auth=auth):
                with self.assertRaisesRegex(ValueError, "issuer and audience are required"):
                    await run_http_team_server(EXAMPLE_TEAM, 0, auth)

    async def test_run_serves_until_cancelled_without_signal_handlers(self) -> None:
        import signal

        before = signal.getsignal(signal.SIGINT)
        serving = asyncio.create_task(run_http_team_server(EXAMPLE_TEAM, 0, AUTH))

        await asyncio.sleep(0.3)

        self.assertFalse(serving.done())
        self.assertIs(signal.getsignal(signal.SIGINT), before)

        serving.cancel()

        with contextlib.suppress(asyncio.CancelledError):
            await serving


if __name__ == "__main__":
    unittest.main()
