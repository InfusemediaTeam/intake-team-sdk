# intake-team-sdk (Python)

The Python toolkit for building an intake MCP server: the JSON Schema wire
contract, server creation, stdio and streamable HTTP transports, service-token
authentication, and the draft, readiness and rendering helpers every team writes
the same way.

It implements the same contract as the JavaScript SDK in this repository
(`spec/` is the single source of truth for both) and follows its contract and
helpers call for call, with snake_case names; the transports differ slightly, as
noted below. A host cannot tell which language a department server is
written in.

Requires Python 3.11 or later. The only runtime dependency is the official
[`mcp`](https://pypi.org/project/mcp/) package (`mcp>=1.30,<2`).

## Install

From a Git tag (nothing is published to PyPI). `v2.0.0` is not tagged yet; until
it is, replace `@v2.0.0` with `@<commit sha>`:

```sh
pip install "git+https://github.com/InfusemediaTeam/intake-team-sdk.git@v2.0.0#subdirectory=packages/python"
```

The package is `intake-team-sdk`; the import is `intake_team_sdk`.

## A minimal team server

A team supplies a `TeamDefinition`: its descriptor, a readiness check, a
renderer, and the function that creates the task. Everything else (tool
publishing, input parsing, authorization, idempotency, error reporting) is the
SDK's.

```python
import asyncio

from intake_team_sdk import (
    INTAKE_CONTRACT_VERSION,
    TaskError,
    TeamDefinition,
    TeamTool,
    compose,
    field_value,
    readiness,
    section,
)


def validate(draft):
    return (
        readiness(draft)
        .require_core("title", "The ticket needs a short title.")
        .require_field("environment", "Which environment is affected?")
        .verdict()
    )


def render(draft):
    return {
        "description": compose(
            [
                section("What is needed", draft["core"]["whatNeeded"]),
                section("Environment", field_value(draft, "environment")),
            ]
        )
    }


async def create_task(input, context):
    # Idempotent on input["idempotencyKey"]: look the key up in your own
    # storage first and return the task it already created.
    try:
        issue = await my_tracker.create(  # your own client
            key=input["idempotencyKey"],
            title=input["draft"]["core"]["title"],
            reporter=input["requester"]["email"],
        )
    except MyTrackerUnavailable:
        raise TaskError("DESTINATION_UNAVAILABLE", "The QA board is not answering", True)

    return {
        "task": {
            "id": issue.id,
            "displayKey": issue.key,
            "url": issue.url,  # http(s) or None
            "location": "QA board",
        }
    }


team = TeamDefinition(
    descriptor={
        "contractVersion": INTAKE_CONTRACT_VERSION,
        "team": {"key": "QA", "title": "QA", "subtitle": "Testing requests"},
        "fields": [
            {
                "key": "environment",
                "label": "Environment",
                "description": "Where the problem happens",
                "kind": "text",
                "required": True,
            }
        ],
        "readinessNotes": ["Name the environment."],
    },
    validate=validate,
    render=render,
    create_task=create_task,
    # Optional: get_task_status=..., tools=(TeamTool(...),)
)
```

### Over stdio

For a host that spawns the server as a child process. Stdout carries the
protocol; diagnostics go to stderr. A definition that cannot start (see "Team
tools" below) exits with status 1.

```python
from intake_team_sdk import run_stdio_team_server

asyncio.run(run_stdio_team_server(team))
```

Over stdio every tool is allowed: only the spawning host can write to the
process, so there is no token and `context.caller` is `None`.

### Over HTTP

For a host that reaches the server across a network. Stateless streamable HTTP;
every request must carry a service token.

```python
from intake_team_sdk import run_http_team_server, service_auth_from_env

auth = service_auth_from_env("QA")  # QA_MCP_JWT_SECRET, QA_MCP_JWT_ISSUER, QA_MCP_JWT_AUDIENCE

asyncio.run(run_http_team_server(team, 8080, auth, host="0.0.0.0"))
```

- `POST /mcp` serves MCP (`path=` changes it). `GET /health` answers
  `{"status":"ok","team":"QA"}` (`health_path=` changes it).
- `host` defaults to `127.0.0.1`; pass `0.0.0.0` to listen on every interface.
- It refuses to start with a secret shorter than 32 characters or a blank issuer
  or audience, raising `ValueError`.
- It serves until the surrounding task is cancelled and installs no signal
  handlers; Ctrl+C ends `asyncio.run` as usual and shuts the listener down.
- `create_http_app(team, auth)` returns the Starlette app without running a
  server, for running it under your own ASGI server or in tests. Its lifespan
  must run, and one app serves once.

## What the server does for you

**Tools.** `tools/list` publishes the contract tools with the input and output
schemas from `spec/`, verbatim: `intake_get_team_descriptor`,
`intake_validate_definition_of_ready`, `intake_render_ticket`,
`intake_create_task`, and `intake_get_task_status` only when the team sets
`get_task_status`. Creation is annotated `readOnlyHint: false,
destructiveHint: false, idempotentHint: true`; every other tool is
`readOnlyHint: true`. Team tools follow.

**Input.** Drafts are read leniently (`to_intake_draft`): an unreadable draft
becomes an empty one, which fails readiness rather than raising. Creation input
is read strictly: a missing or malformed `idempotencyKey`
(`[A-Za-z0-9._:-]{1,128}`), `requester.userId` (1 to 128 characters) or
`requester.email` (a string or `null`, never absent) is refused as
`INVALID_INPUT` before the team is called. `taskIds` must list 1 to 50 ids.

**Creation.** Before `create_task` runs, the server checks the caller's scope,
that the requester is the token's subject, and runs `validate` again: a draft
that is not ready is refused as `NOT_READY` and the team is never called.
Concurrent calls with the same `idempotencyKey` in one process, whoever the
requester, are merged into one `create_task` call, and every caller receives its result. If the
call that started it is cancelled before `create_task` answers, a call still
waiting with the same key starts it again rather than sharing the cancellation.
Retries after that are the team's to recognise: `create_task` must return the
task it already created for a key it has seen. The returned reference is
checked against the output schema, with a non-blank `id` and `displayKey`; a
malformed one is reported as `INTERNAL`.

**Status.** `get_task_status` receives the ids asked about. Statuses for ids not
asked about, or with a field the output schema rejects, are dropped.

**Output.** Every structured result is checked against its tool's output schema
with `jsonschema`, as the MCP client checks it, before it is sent. One the
host's client would reject (an overlong string, too many items) is reported as
`INTERNAL` instead, with where it failed written to stderr. A descriptor that
fails raises `ValueError` when the server is built.

**Errors.** A failed call returns `isError: true` with
`{"error": {"code", "message", "retryable"}}` as JSON text and no
`structuredContent`. Raise `TaskError(code, message, retryable=False)` for a
failure the requester should hear about; its message reaches the requester, so
it must not carry credentials or upstream payloads. Anything else raised is
reported as `INTERNAL`, "The department could not complete the request.",
retryable, and its message is written to stderr only. A successful contract call
returns both `structuredContent` and the same JSON as text.

**Cancellation.** There is no abort signal in `TaskCallContext`: when the host
cancels a call or the connection drops, the handler's task is cancelled.

## Service tokens and the requester

Over HTTP every request carries `Authorization: Bearer <jwt>`, an HS256 token
the host signs with a secret shared with this department only. The token is
checked before the request body is read; a missing or rejected one gets HTTP 401
with `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null}`.

Checked, as `spec/contract.json` requires: the `HS256` header (pinned, never read
from the token), the signature in constant time, `iss`, `aud`, integer `iat` and
`exp` with 30 seconds of clock tolerance, a lifetime of at most 300 seconds, a
`jti`, a `scope` string, a `sub` that is non-empty when present, and a
`task_ids_sha256` that is a base64url SHA-256 when present.

The verified caller reaches the tool as `context.caller` (`ServiceCaller` with
`issuer`, `subject`, `task_ids_digest`, `scopes`, `token_id`, `expires_at`). A
contract tool needs the scope `spec/contract.json` declares for it:
`intake:create` for creation, `intake:read` for every other contract tool. A
team tool with `read_only=False` needs `intake:create`, so a token minted only to
read cannot change state through it; a read-only team tool needs `intake:read`.
Scopes are compared exactly, and any other scope a token carries grants nothing.
For creation,
`requester.userId` must equal the token's `sub`; otherwise the call is refused
as `FORBIDDEN`, so whatever wrote the arguments cannot file a task under someone
else. `intake_get_task_status` needs a `sub` and a `task_ids_sha256` equal to
`task_ids_digest(taskIds)` of the call's own ids — the host signs exactly the ids
it found owned by that requester — or it is refused as `FORBIDDEN` before
`get_task_status` runs.

**Tokens are not single-use.** No `jti` is remembered, so whoever holds a valid
token can send it again until it expires: up to 300 seconds after `iat`, plus the
30 seconds of clock tolerance. The token's claims bound what a replay can do (the
same scopes, `sub` and `task_ids_sha256`), not how often. Idempotency is not
replay protection: a replayed create token sent with a new `idempotencyKey` and
any draft creates another task for that requester. Keep the HTTP leg on TLS,
token lifetimes short and tokens out of logs. A department that needs one-time
use must remember `context.caller.token_id` itself, until `expires_at` plus the
tolerance; the SDK does not.

`sign_service_token(...)` is for hosts and tests; `verify_service_token(token,
options)` is what the HTTP transport runs. Both use the standard library only.

## Team tools

A team may offer extra tools to the host's assistant as `TeamTool(name, title,
description, input_schema, read_only, execute)`, where `execute(args)` returns a
string or an awaitable string. A host adapts only `read_only=True` tools into
the assistant's toolset, and over HTTP a `read_only=False` tool needs a token
with `intake:create`. Names starting with `intake_` are reserved for the
contract, and two tools may not share a name; either stops
`create_team_server` with `ValueError`.

## Helpers

- Drafts: `filled`, `field_value`, `to_intake_draft`, `draft_prose`,
  `includes_any`.
- Readiness: `readiness(draft)` returns a chainable `ReadinessReport` with
  `block`, `warn`, `block_when`, `require_core`, `require_field`,
  `require_enum_field` (with `EnumFieldMessages(missing, invalid)`),
  `warn_missing_field` and `verdict()`.
- Rendering: `section`, `bullets`, `labelled`, `compose`.
- Configuration: `required_env`, `required_env_list`, `read_pairs`,
  `service_auth_from_env(prefix)`.

Text is trimmed and measured as JavaScript does (its whitespace set, UTF-16
lengths), so both SDKs judge a draft identically.

## Contract types

`_generated.py` is generated from `spec/` by `npm run generate` at the repository
root (after `npm install` there) and must not be edited by hand;
`npm run check:generated` fails when it is stale. The package re-exports
its `TypedDict`s (`TeamDescriptor`, `IntakeDraft`, `CreateTaskInput`,
`TaskReference`, `TaskStatusResult`, `ToolErrorBody`, ...), `TOOL_CONTRACTS`,
and the constants `INTAKE_CONTRACT_VERSION`, `CONTRACT_TOOL_PREFIX`,
`CONTRACT_TOOL_NAMES`, the tool names, `READ_SCOPE` and `CREATE_SCOPE`.

## Tests

From `packages/python/`, with `mcp` installed in the active environment:

```sh
python -m unittest discover -s tests
```

Lint and type-check with the pinned tools, as CI does:

```sh
pip install -r requirements-dev.txt
ruff check src tests
mypy
```

The suite runs against `src/` directly. It validates the shared fixtures in
`spec/fixtures/` with `jsonschema`, verifies every service-token vector, drives
the server through an in-process MCP client, serves HTTP on an ephemeral port,
and spawns the stdio server as a child process.
