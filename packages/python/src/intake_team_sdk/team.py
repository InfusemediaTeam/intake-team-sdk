"""What one team hands the SDK."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from ._generated import (
    CreateTaskInput,
    CreateTaskResult,
    IntakeDraft,
    ReadinessVerdict,
    RenderedTicket,
    TaskStatusResult,
    TeamDescriptor,
)
from .service_token import ServiceCaller


@dataclass(frozen=True)
class TeamTool:
    """
    An extra tool a team offers the host's assistant.

    `read_only` is the safety gate a host is expected to enforce: it adapts a
    team tool into the assistant's toolset only when the tool declares itself
    read-only, so a team cannot hand the model something that changes state
    behind the host's back.
    """

    name: str
    title: str
    description: str
    input_schema: Mapping[str, Any]
    """JSON Schema for the arguments, published verbatim by `tools/list`."""
    read_only: bool
    execute: Callable[[Mapping[str, Any]], str | Awaitable[str]]


@dataclass(frozen=True)
class TaskCallContext:
    """
    What a task handler knows about the call beyond its arguments.

    There is no abort signal as in the JavaScript SDK: when the host cancels
    the call or the connection drops, the handler's task is cancelled.
    """

    caller: ServiceCaller | None
    """
    The verified service token's caller over HTTP; `None` over stdio, where
    the host that spawned the process is the only one who can write to it.
    """


@dataclass(eq=False)
class TeamDefinition:
    """
    Everything one team owns.

    `validate` and `render` are fast and free of network calls: a host calls
    them on every turn of an interview and treats an overrun as the server
    being unhealthy. `create_task` and `get_task_status` are where a team does
    its own I/O.

    `create_task` is only called after `validate` passed and the caller was
    authorized. It must be idempotent on `input["idempotencyKey"]`: the host
    retries with the same key after a timeout or failure, and a second call
    must return the task the first one created rather than open another. The
    server also merges concurrent calls with the same key inside one process,
    but only the team's own storage can recognise a task created before a
    restart. Raise `TaskError` for a failure the requester should hear about.

    `get_task_status` is optional: without it the host reports the status as
    unavailable. An unknown id is left out of its answer.

    Compared by identity (`eq=False`), because concurrent creations are merged
    per definition object.
    """

    descriptor: TeamDescriptor
    validate: Callable[[IntakeDraft], ReadinessVerdict]
    render: Callable[[IntakeDraft], RenderedTicket]
    create_task: Callable[[CreateTaskInput, TaskCallContext], Awaitable[CreateTaskResult]]
    get_task_status: (
        Callable[[list[str], TaskCallContext], Awaitable[TaskStatusResult]] | None
    ) = None
    tools: Sequence[TeamTool] = field(default_factory=tuple)
