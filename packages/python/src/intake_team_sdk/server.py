"""One team definition wrapped as an MCP server."""

from __future__ import annotations

import copy
import inspect
import json
import sys
import weakref
from collections.abc import Callable, Sequence
from typing import Any

import anyio
import mcp.types as types
from mcp.server.lowlevel import Server

from ._generated import SDK_VERSION, TOOL_CONTRACTS, CreateTaskInput, CreateTaskResult
from .contract import (
    CONTRACT_TOOL_PREFIX,
    CREATE_SCOPE,
    CREATE_TASK_TOOL,
    GET_TASK_STATUS_TOOL,
    GET_TEAM_DESCRIPTOR_TOOL,
    READ_SCOPE,
    RENDER_TICKET_TOOL,
    VALIDATE_DEFINITION_OF_READY_TOOL,
)
from .draft import to_intake_draft
from .service_token import ServiceCaller, task_ids_digest
from .task import (
    TaskError,
    checked_statuses,
    checked_task_reference,
    to_create_task_input,
    to_task_ids,
)
from .team import TaskCallContext, TeamDefinition, TeamTool

_INTERNAL_MESSAGE = "The department could not complete the request."

CallerResolver = Callable[[Server[Any, Any]], ServiceCaller | None]


class _Flight:
    """One creation in flight, awaited by every concurrent call with its key."""

    def __init__(self) -> None:
        self.done = anyio.Event()
        self.settled = False
        self.result: CreateTaskResult | None = None
        self.error: BaseException | None = None


# Creations in flight per team and key, shared by every server built for the
# same definition: a host's concurrent retries must meet here whichever server
# object or HTTP request carries them.
_in_flight: weakref.WeakKeyDictionary[TeamDefinition, dict[str, _Flight]] = (
    weakref.WeakKeyDictionary()
)


def create_team_server(
    definition: TeamDefinition, caller: ServiceCaller | None = None
) -> Server[Any, Any]:
    """
    Wraps one team definition as an MCP server.

    The transport is the caller's choice (stdio for a server the host spawns,
    streamable HTTP for one it reaches over the network), so this knows nothing
    about how it is connected. Every team publishes the same contract tools,
    with the input and output schemas from `spec/`, which is what lets a host
    treat them interchangeably.

    `caller` is the verified service-token caller for a server reached over
    HTTP; `None` for stdio, where only the spawning host can write to the
    process, so every tool is allowed.

    The low-level `Server` rather than `FastMCP`: tools' JSON Schema is
    published verbatim, because a host converts a model-facing schema into its
    own schema type and a generated one would carry shapes it has to reject.

    Raises `ValueError` if a team tool uses the reserved `intake_` prefix, or
    two team tools share a name.
    """
    return build_team_server(definition, lambda _server: caller)


def build_team_server(
    definition: TeamDefinition, resolve_caller: CallerResolver
) -> Server[Any, Any]:
    """
    `create_team_server` with the caller looked up per call, for a transport
    that authenticates each request rather than each process.
    """
    team_tools = tuple(definition.tools)

    _assert_tool_names_usable(team_tools)

    server: Server[Any, Any] = Server(_server_name(definition), version=SDK_VERSION)
    contract_tools = [
        tool
        for tool in TOOL_CONTRACTS
        if tool["name"] != GET_TASK_STATUS_TOOL or definition.get_task_status is not None
    ]
    listed = [_contract_tool(tool) for tool in contract_tools] + [
        _team_tool(tool) for tool in team_tools
    ]

    async def list_tools(_request: types.ListToolsRequest | None) -> types.ServerResult:
        return types.ServerResult(types.ListToolsResult(tools=listed))

    async def call_tool(request: types.CallToolRequest) -> types.ServerResult:
        name = request.params.name
        args = request.params.arguments

        try:
            caller = resolve_caller(server)
            context = TaskCallContext(caller=caller)

            _authorize(caller, _required_scope(name, team_tools))

            result = await _dispatch(definition, team_tools, name, args, context)
        except Exception as error:
            result = _failure(definition, name, error)

        return types.ServerResult(result)

    # Registered directly rather than through the decorators: those validate
    # arguments against the published schema first, which would answer a
    # malformed call with the library's own error text instead of the
    # contract's `INVALID_INPUT` (or, for a draft, a "not ready" verdict).
    server.request_handlers[types.ListToolsRequest] = list_tools
    server.request_handlers[types.CallToolRequest] = call_tool

    return server


async def _dispatch(
    definition: TeamDefinition,
    team_tools: Sequence[TeamTool],
    name: str,
    args: dict[str, Any] | None,
    context: TaskCallContext,
) -> types.CallToolResult:
    if name == GET_TEAM_DESCRIPTOR_TOOL:
        return _structured(definition.descriptor)

    if name == VALIDATE_DEFINITION_OF_READY_TOOL:
        return _structured(definition.validate(to_intake_draft(args)))

    if name == RENDER_TICKET_TOOL:
        return _structured(definition.render(to_intake_draft(args)))

    if name == CREATE_TASK_TOOL:
        return _structured(
            await _create_task(definition, to_create_task_input(args), context)
        )

    if name == GET_TASK_STATUS_TOOL and definition.get_task_status is not None:
        task_ids = to_task_ids(args)

        _authorize_status_read(context.caller, task_ids)

        return _structured(
            checked_statuses(await definition.get_task_status(task_ids, context), task_ids)
        )

    tool = next((candidate for candidate in team_tools if candidate.name == name), None)

    if tool is not None:
        text = tool.execute(args if args is not None else {})

        if inspect.isawaitable(text):
            text = await text

        return types.CallToolResult(content=[types.TextContent(type="text", text=text)])

    raise TaskError("INVALID_INPUT", f"Unknown tool: {name}")


async def _create_task(
    definition: TeamDefinition, input: CreateTaskInput, context: TaskCallContext
) -> CreateTaskResult:
    """
    The generic gates in front of a team's own `create_task`.

    The requester must be the token's subject, so a host cannot be tricked into
    filing a task under someone else by whatever wrote the arguments. The draft
    must pass the team's own readiness check again: confirmation at the host is
    a claim about the draft, and this is where it is checked.
    """
    if context.caller is not None and context.caller.subject != input["requester"]["userId"]:
        raise TaskError("FORBIDDEN", "The requester does not match the authenticated caller")

    verdict = definition.validate(input["draft"])

    if not verdict.get("ready"):
        raise TaskError("NOT_READY", "The draft does not meet the Definition of Ready")

    pending = _in_flight.setdefault(definition, {})
    key = f"{input['requester']['userId']}\u0000{input['idempotencyKey']}"

    while (running := pending.get(key)) is not None:
        await running.done.wait()

        if running.settled:
            if running.error is not None:
                raise running.error

            assert running.result is not None

            return running.result

        # The call that owned the creation was cancelled before it settled, so
        # nothing is known about the task; this call takes the creation over.

    flight = _Flight()
    pending[key] = flight

    try:
        result = await definition.create_task(input, context)
        flight.result = {"task": checked_task_reference(result["task"])}
        flight.settled = True

        return flight.result
    except Exception as error:
        flight.error = error
        flight.settled = True

        raise
    finally:
        if pending.get(key) is flight:
            del pending[key]

        flight.done.set()


def _required_scope(name: str, team_tools: Sequence[TeamTool]) -> str:
    """
    The scope a call needs, decided on the server rather than left to which
    tools a host shows a model.

    A contract tool needs the scope `spec/` declares for it. A team tool that
    is not read-only needs `intake:create`, the scope that already lets a
    caller change state, so a token minted only to read never reaches one. A
    read-only team tool, or a name nothing answers to, needs `intake:read`.
    """
    contract = next((tool for tool in TOOL_CONTRACTS if tool["name"] == name), None)

    if contract is not None:
        scope: str = contract["scope"]

        return scope

    tool = next((candidate for candidate in team_tools if candidate.name == name), None)

    return CREATE_SCOPE if tool is not None and not tool.read_only else READ_SCOPE


def _authorize(caller: ServiceCaller | None, scope: str) -> None:
    """Raises `TaskError` when a token caller lacks the scope."""
    if caller is not None and scope not in caller.scopes:
        raise TaskError("FORBIDDEN", f"This call needs the {scope} scope")


def _authorize_status_read(caller: ServiceCaller | None, task_ids: Sequence[str]) -> None:
    """
    A token caller reads only the tasks its token was issued for.

    The host is the one that knows whose task is whose: it signs the requester
    as `sub` and the ids it found owned by them as `task_ids_sha256`. Requiring
    both, and an exact match on the ids, means a token can never read a task
    id added to the call after signing, and one issued without a requester —
    for discovery or a preview — reads none at all.

    Raises `TaskError` `FORBIDDEN` otherwise; the reason is not told apart, so
    a refusal says nothing about whose tasks these are.
    """
    if caller is None:
        return

    try:
        covered = caller.task_ids_digest == task_ids_digest(task_ids)
    except ValueError:
        covered = False

    if caller.subject is None or caller.task_ids_digest is None or not covered:
        raise TaskError("FORBIDDEN", "This token does not cover these tasks")


def _assert_tool_names_usable(tools: Sequence[TeamTool]) -> None:
    """
    Every team tool name checked before the server is handed back.

    The whole `intake_` prefix is reserved, not just today's names, so a
    contract tool added later can never be shadowed by a team tool that took
    its name first. Two team tools sharing a name would be resolved silently by
    declaration order. Both stop startup rather than misroute a call later.
    """
    seen: set[str] = set()

    for tool in tools:
        if tool.name.startswith(CONTRACT_TOOL_PREFIX):
            raise ValueError(
                f'Team tool "{tool.name}" uses the "{CONTRACT_TOOL_PREFIX}" prefix, '
                "which the intake contract reserves."
            )

        if tool.name in seen:
            raise ValueError(f'Team tool "{tool.name}" is declared more than once.')

        seen.add(tool.name)


def _contract_tool(tool: dict[str, Any]) -> types.Tool:
    annotations = types.ToolAnnotations(readOnlyHint=tool["readOnly"])

    if not tool["readOnly"]:
        annotations.destructiveHint = False
        annotations.idempotentHint = True

    return types.Tool(
        name=tool["name"],
        title=tool["title"],
        description=tool["description"],
        inputSchema=copy.deepcopy(tool["inputSchema"]),
        outputSchema=copy.deepcopy(tool["outputSchema"]),
        annotations=annotations,
    )


def _team_tool(tool: TeamTool) -> types.Tool:
    return types.Tool(
        name=tool.name,
        title=tool.title,
        description=tool.description,
        inputSchema=copy.deepcopy(dict(tool.input_schema)),
        annotations=types.ToolAnnotations(readOnlyHint=tool.read_only),
    )


def _structured(payload: Any) -> types.CallToolResult:
    """
    A contract result, sent both ways.

    `structuredContent` is what a host reads; the JSON text alongside it keeps
    the result legible to any MCP client that only understands content blocks.
    """
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=_json(payload))],
        structuredContent=payload,
    )


def _failure(definition: TeamDefinition, tool: str, error: Exception) -> types.CallToolResult:
    """
    The contract's error result: the JSON of `ToolError` as text, and no
    `structuredContent`, which a client would validate against the success
    schema. An unexpected error is logged here and reported generically, so
    nothing internal reaches the requester.
    """
    if isinstance(error, TaskError):
        body: dict[str, Any] = dict(error.to_body())
    else:
        body = {"code": "INTERNAL", "message": _INTERNAL_MESSAGE, "retryable": True}
        sys.stderr.write(f"{_server_name(definition)} {tool} failed: {error}\n")

    return types.CallToolResult(
        content=[types.TextContent(type="text", text=_json({"error": body}))],
        isError=True,
    )


def _json(payload: Any) -> str:
    """As `JSON.stringify` writes it, so both SDKs send the same text."""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _server_name(definition: TeamDefinition) -> str:
    return f"intake-{definition.descriptor['team']['key'].lower()}"
