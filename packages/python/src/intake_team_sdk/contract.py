"""
The wire contract between an intake host and a team MCP server.

Versioned, because a host refuses a descriptor whose major version it does not
understand: a team that ships a breaking change must say so rather than have
the host guess at a shape it cannot read. Defined in `spec/`; the shapes are
generated into `_generated.py` and re-exported here.

Declared for a server's own use. A host is not expected to import them: it
re-declares its own and validates every field on the way in, because a shared
type across a process boundary is a promise, not a check.
"""

from __future__ import annotations

from typing import Literal

from ._generated import (
    CONTRACT_VERSION,
    RESERVED_TOOL_PREFIX,
    SCOPES,
    TOOL_CONTRACTS,
    CreateTaskInput,
    CreateTaskResult,
    IntakeCoreFields,
    IntakeDraft,
    IntakeRequester,
    ReadinessIssue,
    ReadinessVerdict,
    RenderedTicket,
    ServiceTokenClaims,
    TaskReference,
    TaskRequester,
    TaskStatus,
    TaskStatusInput,
    TaskStatusResult,
    TeamDescriptor,
    TeamField,
    TeamIdentity,
    ToolError,
    ToolErrorBody,
    ToolErrorCode,
)

INTAKE_CONTRACT_VERSION = CONTRACT_VERSION

# Every tool name starting with this belongs to the contract. A team tool may
# not use it, so a later contract tool can never collide with one.
CONTRACT_TOOL_PREFIX = RESERVED_TOOL_PREFIX

# The contract tools, called by the host only and never exposed to a model: a
# model must not be able to pass its own readiness check, render its own ticket
# or create a task.
GET_TEAM_DESCRIPTOR_TOOL = "intake_get_team_descriptor"
VALIDATE_DEFINITION_OF_READY_TOOL = "intake_validate_definition_of_ready"
RENDER_TICKET_TOOL = "intake_render_ticket"
CREATE_TASK_TOOL = "intake_create_task"
GET_TASK_STATUS_TOOL = "intake_get_task_status"

CONTRACT_TOOL_NAMES: tuple[str, ...] = (
    GET_TEAM_DESCRIPTOR_TOOL,
    VALIDATE_DEFINITION_OF_READY_TOOL,
    RENDER_TICKET_TOOL,
    CREATE_TASK_TOOL,
    GET_TASK_STATUS_TOOL,
)

# Granted by a service token; `intake:create` is needed only for creation.
READ_SCOPE = SCOPES["read"]
CREATE_SCOPE = SCOPES["create"]

# The 1.x name for a readiness verdict, kept so team code reads the same.
DefinitionOfReadyVerdict = ReadinessVerdict

# How a field is rendered and filled.
TeamFieldKind = Literal["text", "longText", "enum"]

# The three states every department's own workflow maps onto.
TaskStatusCategory = Literal["todo", "in_progress", "done"]

__all__ = [
    "CONTRACT_TOOL_NAMES",
    "CONTRACT_TOOL_PREFIX",
    "CREATE_SCOPE",
    "CREATE_TASK_TOOL",
    "GET_TASK_STATUS_TOOL",
    "GET_TEAM_DESCRIPTOR_TOOL",
    "INTAKE_CONTRACT_VERSION",
    "READ_SCOPE",
    "RENDER_TICKET_TOOL",
    "TOOL_CONTRACTS",
    "VALIDATE_DEFINITION_OF_READY_TOOL",
    "CreateTaskInput",
    "CreateTaskResult",
    "DefinitionOfReadyVerdict",
    "IntakeCoreFields",
    "IntakeDraft",
    "IntakeRequester",
    "ReadinessIssue",
    "ReadinessVerdict",
    "RenderedTicket",
    "ServiceTokenClaims",
    "TaskReference",
    "TaskRequester",
    "TaskStatus",
    "TaskStatusCategory",
    "TaskStatusInput",
    "TaskStatusResult",
    "TeamDescriptor",
    "TeamField",
    "TeamFieldKind",
    "TeamIdentity",
    "ToolError",
    "ToolErrorBody",
    "ToolErrorCode",
]
