"""
The example team served over stdio, as a host would spawn it. With `--reserved`
it declares a tool under the contract's prefix, so startup must fail.
"""

from __future__ import annotations

import sys
from dataclasses import replace

import anyio

from example_team import EXAMPLE_TOOL, example_team
from intake_team_sdk import run_stdio_team_server

if __name__ == "__main__":
    team = example_team()

    if "--reserved" in sys.argv:
        team = replace(team, tools=(replace(EXAMPLE_TOOL, name="intake_mine"),))

    anyio.run(run_stdio_team_server, team)
