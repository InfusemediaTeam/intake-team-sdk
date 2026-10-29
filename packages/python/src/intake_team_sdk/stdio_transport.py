"""Serving one team to a host that spawns it as a child process."""

from __future__ import annotations

import sys

from mcp.server.stdio import stdio_server

from .server import _server_name, create_team_server
from .team import TeamDefinition

_STARTUP_FAILURE_EXIT_CODE = 1


async def run_stdio_team_server(definition: TeamDefinition) -> None:
    """
    Serves one team over stdio until the host closes stdin.

    Run it with `anyio.run(run_stdio_team_server, team)` or
    `asyncio.run(run_stdio_team_server(team))`.

    Nothing is written to stdout: that channel carries the JSON-RPC framing,
    and a stray line there desynchronises the protocol. Diagnostics go to
    stderr, which a spawning host captures.

    A failure to start exits non-zero rather than raising into the caller's
    event loop: a server that stays up without a transport looks healthy while
    answering nothing.
    """
    name = _server_name(definition)

    try:
        server = create_team_server(definition)
    except Exception as error:
        sys.stderr.write(f"{name} failed to start: {error}\n")
        sys.exit(_STARTUP_FAILURE_EXIT_CODE)

    async with stdio_server() as (read_stream, write_stream):
        sys.stderr.write(f"{name} MCP server ready on stdio\n")
        sys.stderr.flush()

        await server.run(read_stream, write_stream, server.create_initialization_options())
