"""
Shared test plumbing: the working tree's `src/` on the path, the spec files,
and an in-process MCP client.

`src/` is put first so the suite always runs against the code beside it, even
when an older copy of the package is installed in the same environment.
"""

from __future__ import annotations

import json
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

PYTHON_ROOT = Path(__file__).resolve().parent.parent
SRC = PYTHON_ROOT / "src"
SPEC = PYTHON_ROOT.parent.parent / "spec"

if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

# `IsolatedAsyncioTestCase` runs its loop in debug mode, which reports every
# callback slower than 100 ms; a cold import inside one is not a finding.
logging.getLogger("asyncio").setLevel(logging.ERROR)

from mcp import ClientSession  # noqa: E402
from mcp.shared.memory import create_connected_server_and_client_session  # noqa: E402

from intake_team_sdk import (  # noqa: E402
    ServiceCaller,
    TeamDefinition,
    create_team_server,
    task_ids_digest,
)


def read_spec(relative: str) -> Any:
    return json.loads((SPEC / relative).read_text(encoding="utf-8"))


@asynccontextmanager
async def connect(
    definition: TeamDefinition, caller: ServiceCaller | None = None
) -> AsyncIterator[ClientSession]:
    """A live client wired to a server over memory streams: no process, no port."""
    server = create_team_server(definition, caller)

    async with create_connected_server_and_client_session(server) as client:
        # As a host does: listing first caches each tool's output schema, so
        # every structured result is also validated against `spec/`.
        await client.list_tools()

        yield client


def caller_for(
    subject: str | None,
    scopes: tuple[str, ...],
    task_ids: list[str] | None = None,
) -> ServiceCaller:
    return ServiceCaller(
        issuer="host",
        subject=subject,
        task_ids_digest=None if task_ids is None else task_ids_digest(task_ids),
        scopes=scopes,
        token_id="jti",
        expires_at=0,
    )


def error_of(result: Any) -> dict[str, Any]:
    return json.loads(result.content[0].text)["error"]
