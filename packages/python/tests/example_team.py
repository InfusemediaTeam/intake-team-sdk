"""
A deliberately uninteresting team, so the suites exercise the SDK rather than
anybody's rules. Its tasks live in memory, keyed the way a real team keys its
own storage: by idempotency key.
"""

from __future__ import annotations

import copy
from typing import Any

import support  # noqa: F401  (puts src/ on the path)

import anyio

from intake_team_sdk import (
    INTAKE_CONTRACT_VERSION,
    CreateTaskInput,
    IntakeDraft,
    TaskCallContext,
    TaskReference,
    TeamDefinition,
    TeamTool,
    compose,
    readiness,
    section,
)

EXAMPLE_TOOL = TeamTool(
    name="example_reference",
    title="Example reference",
    description="Returns a fixed string.",
    input_schema={"type": "object", "properties": {}},
    read_only=True,
    execute=lambda _args: "reference text",
)

DESCRIPTOR: Any = {
    "contractVersion": INTAKE_CONTRACT_VERSION,
    "team": {"key": "EXAMPLE", "title": "Example team", "subtitle": "For tests"},
    "fields": [
        {
            "key": "exampleField",
            "label": "Example field",
            "description": "Something the team asks for.",
            "kind": "text",
            "required": True,
        }
    ],
    "readinessNotes": ["The example field is required."],
}


class ExampleTeam(TeamDefinition):
    """A `TeamDefinition` that also exposes what it was asked to do."""

    created: dict[str, TaskReference]
    calls: list[CreateTaskInput]
    contexts: list[TaskCallContext]


def validate(draft: IntakeDraft) -> Any:
    return (
        readiness(draft)
        .require_core("title", "The ticket needs a short title.")
        .require_field("exampleField", "Fill in the example field.")
        .verdict()
    )


def render(draft: IntakeDraft) -> Any:
    return {"description": compose([section("Summary", draft["core"]["whatNeeded"])])}


def example_team() -> ExampleTeam:
    created: dict[str, TaskReference] = {}
    calls: list[CreateTaskInput] = []
    contexts: list[TaskCallContext] = []

    async def create_task(input: CreateTaskInput, context: TaskCallContext) -> Any:
        calls.append(input)
        contexts.append(context)
        # A turn of the event loop, so concurrent calls genuinely overlap.
        await anyio.sleep(0.01)

        existing = created.get(input["idempotencyKey"])

        if existing is not None:
            return {"task": existing}

        number = len(created) + 1
        task: TaskReference = {
            "id": f"task-{number}",
            "displayKey": f"EX-{number}",
            "url": f"https://tasks.example.test/EX-{number}",
            "location": "Example queue",
        }
        created[input["idempotencyKey"]] = task

        return {"task": task}

    async def get_task_status(task_ids: list[str], _context: TaskCallContext) -> Any:
        return {
            "statuses": [
                {
                    "taskId": task["id"],
                    "category": "todo",
                    "label": "Open",
                    "assignee": None,
                    "lastChangedAt": None,
                }
                for task in created.values()
                if task["id"] in task_ids
            ]
        }

    team = ExampleTeam(
        descriptor=DESCRIPTOR,
        validate=validate,
        render=render,
        create_task=create_task,
        get_task_status=get_task_status,
        tools=(EXAMPLE_TOOL,),
    )
    team.created = created
    team.calls = calls
    team.contexts = contexts

    return team


EXAMPLE_TEAM = example_team()

EXAMPLE_DRAFT: Any = {
    "core": {
        "title": "A title",
        "whatNeeded": "Some work",
        "urgency": None,
        "businessValue": None,
        "approver": None,
    },
    "fieldValues": {},
    "requester": {"displayName": "Ada Lovelace", "department": "Research"},
}

READY_DRAFT: Any = {**copy.deepcopy(EXAMPLE_DRAFT), "fieldValues": {"exampleField": "filled"}}

ABSENT: Any = object()
"""Passed to `create_args` to leave an argument out entirely."""


def create_args(**overrides: Any) -> dict[str, Any]:
    args: dict[str, Any] = {
        "idempotencyKey": "request-1",
        "draft": READY_DRAFT,
        "requester": {"userId": "user-1", "email": "ada@example.test"},
    }
    args.update(overrides)

    return {key: value for key, value in args.items() if value is not ABSENT}


def minimal_team(**overrides: Any) -> TeamDefinition:
    """The team without its own tools or status lookup, so the required surface stands alone."""
    team = example_team()
    fields: dict[str, Any] = {
        "descriptor": team.descriptor,
        "validate": team.validate,
        "render": team.render,
        "create_task": team.create_task,
    }
    fields.update(overrides)

    return TeamDefinition(**fields)
