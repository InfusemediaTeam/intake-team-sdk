"""
intake-team-sdk: the toolkit for building an intake MCP server in Python.

Everything here is department-independent: the wire contract generated from
`spec/`, the server and its transports, service-token authentication, and
helpers for the parts every team writes the same way. What a team asks for,
when it considers a draft ready, how it renders a ticket and where it creates
the task are the team's own and belong in the department's own package.

The JavaScript SDK in the same repository implements the same contract; this
package follows it call for call, with snake_case names.
"""

from .contract import (
    CONTRACT_TOOL_NAMES,
    CONTRACT_TOOL_PREFIX,
    CREATE_SCOPE,
    CREATE_TASK_TOOL,
    GET_TASK_STATUS_TOOL,
    GET_TEAM_DESCRIPTOR_TOOL,
    INTAKE_CONTRACT_VERSION,
    READ_SCOPE,
    RENDER_TICKET_TOOL,
    TOOL_CONTRACTS,
    VALIDATE_DEFINITION_OF_READY_TOOL,
    CreateTaskInput,
    CreateTaskResult,
    DefinitionOfReadyVerdict,
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
    TaskStatusCategory,
    TaskStatusInput,
    TaskStatusResult,
    TeamDescriptor,
    TeamField,
    TeamFieldKind,
    TeamIdentity,
    ToolError,
    ToolErrorBody,
    ToolErrorCode,
)
from .draft import draft_prose, field_value, filled, includes_any, to_intake_draft
from .env import read_pairs, required_env, required_env_list, service_auth_from_env
from .http_transport import create_http_app, run_http_team_server
from .readiness import EnumFieldMessages, ReadinessReport, readiness
from .render import bullets, compose, labelled, section
from .server import create_team_server
from .service_token import (
    ServiceCaller,
    ServiceTokenError,
    ServiceTokenOptions,
    sign_service_token,
    task_ids_digest,
    verify_service_token,
)
from .stdio_transport import run_stdio_team_server
from .task import TaskError
from .team import TaskCallContext, TeamDefinition, TeamTool

__version__ = "2.0.0"

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
    "EnumFieldMessages",
    "IntakeCoreFields",
    "IntakeDraft",
    "IntakeRequester",
    "ReadinessIssue",
    "ReadinessReport",
    "ReadinessVerdict",
    "RenderedTicket",
    "ServiceCaller",
    "ServiceTokenClaims",
    "ServiceTokenError",
    "ServiceTokenOptions",
    "TaskCallContext",
    "TaskError",
    "TaskReference",
    "TaskRequester",
    "TaskStatus",
    "TaskStatusCategory",
    "TaskStatusInput",
    "TaskStatusResult",
    "TeamDefinition",
    "TeamDescriptor",
    "TeamField",
    "TeamFieldKind",
    "TeamIdentity",
    "TeamTool",
    "ToolError",
    "ToolErrorBody",
    "ToolErrorCode",
    "bullets",
    "compose",
    "create_http_app",
    "create_team_server",
    "draft_prose",
    "field_value",
    "filled",
    "includes_any",
    "labelled",
    "read_pairs",
    "readiness",
    "required_env",
    "required_env_list",
    "run_http_team_server",
    "run_stdio_team_server",
    "section",
    "service_auth_from_env",
    "sign_service_token",
    "task_ids_digest",
    "to_intake_draft",
    "verify_service_token",
]
