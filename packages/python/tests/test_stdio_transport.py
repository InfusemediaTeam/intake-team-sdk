"""The stdio path end to end: the example team in a child process, as a host spawns it."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from support import SRC

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from intake_team_sdk import CONTRACT_TOOL_NAMES, GET_TEAM_DESCRIPTOR_TOOL

SCRIPT = Path(__file__).resolve().parent / "stdio_team.py"


def child_env() -> dict[str, str]:
    tests = str(SCRIPT.parent)

    return {**os.environ, "PYTHONPATH": os.pathsep.join([tests, str(SRC)])}


class StdioTransportTest(unittest.IsolatedAsyncioTestCase):
    async def test_serves_the_contract_and_keeps_stdout_for_the_protocol(self) -> None:
        parameters = StdioServerParameters(
            command=sys.executable, args=[str(SCRIPT)], env=child_env()
        )

        with tempfile.TemporaryFile("w+", encoding="utf-8") as errors:
            async with (
                stdio_client(parameters, errlog=errors) as (read, write),
                ClientSession(read, write) as session,
            ):
                initialized = await session.initialize()
                names = [tool.name for tool in (await session.list_tools()).tools]
                result = await session.call_tool(GET_TEAM_DESCRIPTOR_TOOL, {})

            errors.seek(0)
            logged = errors.read()

        self.assertEqual(initialized.serverInfo.name, "intake-example")
        self.assertEqual(names, [*CONTRACT_TOOL_NAMES, "example_reference"])
        assert result.structuredContent is not None
        self.assertEqual(result.structuredContent["team"]["key"], "EXAMPLE")
        self.assertIn("intake-example MCP server ready on stdio", logged)

    def test_exits_non_zero_when_the_team_cannot_start(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(SCRIPT), "--reserved"],
            env=child_env(),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=60,
        )

        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout, "")
        self.assertIn("intake-example failed to start:", completed.stderr)
        self.assertIn("reserves", completed.stderr)


if __name__ == "__main__":
    unittest.main()
