# Generated from spec/ and the package.json version by scripts/generate-contract.mjs. Do not edit.
# ruff: noqa

from __future__ import annotations

import json
from typing import Any, Literal, NotRequired, TypedDict

SDK_VERSION = "2.0.0"

CONTRACT_VERSION = "2.0"

RESERVED_TOOL_PREFIX = "intake_"

SCOPES: dict[str, str] = json.loads(r'''{"read":"intake:read","create":"intake:create"}''')

SERVICE_TOKEN_RULES: dict[str, Any] = json.loads(r'''{"algorithm":"HS256","minSecretLength":32,"maxLifetimeSeconds":300,"clockToleranceSeconds":30}''')


class TeamIdentity(TypedDict):
    key: str
    title: str
    subtitle: str


class TeamField(TypedDict):
    key: str
    label: str
    description: str
    kind: Literal["text", "longText", "enum"]
    required: bool
    options: NotRequired[list[str]]


class TeamDescriptor(TypedDict):
    contractVersion: str
    team: TeamIdentity
    fields: list[TeamField]
    readinessNotes: list[str]


NullableText = str | None


class IntakeCoreFields(TypedDict):
    title: NullableText
    whatNeeded: NullableText
    urgency: NullableText
    businessValue: NullableText
    approver: NullableText


class IntakeRequester(TypedDict):
    """Who asked, as shown on a draft. Display data only: the identity a department may act on is TaskRequester, sent with creation."""
    displayName: NullableText
    department: NullableText


class IntakeDraft(TypedDict):
    core: IntakeCoreFields
    fieldValues: dict[str, str]
    requester: IntakeRequester


class EmptyInput(TypedDict):
    pass


class DraftInput(TypedDict):
    draft: IntakeDraft


class ReadinessIssue(TypedDict):
    field: NotRequired[str]
    message: str


class ReadinessVerdict(TypedDict):
    ready: bool
    blockers: list[ReadinessIssue]
    warnings: list[ReadinessIssue]


class RenderedTicket(TypedDict):
    description: str
    summary: NotRequired[str]


class TaskRequester(TypedDict):
    """The authenticated requester, resolved by the host from its own records. Over HTTP, userId must equal the service token's sub claim."""
    userId: str
    email: NullableText


class CreateTaskInput(TypedDict):
    idempotencyKey: str
    """Stable for every attempt at one request. A department must return the same task for a key it has already created."""
    draft: IntakeDraft
    requester: TaskRequester


class TaskReference(TypedDict):
    id: str
    """The department's own id for the task. The host passes it back to intake_get_task_status."""
    displayKey: str
    """What the requester sees, e.g. PROJ-123."""
    url: str | None
    """An http(s) link to the task, or null when it has none."""
    location: str | None
    """Where the task was filed, in the department's words: a board, queue or label."""


class CreateTaskResult(TypedDict):
    task: TaskReference


class TaskStatusInput(TypedDict):
    taskIds: list[str]


class TaskStatus(TypedDict):
    taskId: str
    category: Literal["todo", "in_progress", "done"]
    label: str
    """The department's own wording for the state."""
    assignee: str | None
    lastChangedAt: str | None
    """ISO-8601, when the department last changed the task."""


class TaskStatusResult(TypedDict):
    """One entry per task the department knows. An id it does not know is left out."""
    statuses: list[TaskStatus]


ToolErrorCode = Literal["INVALID_INPUT", "UNAUTHORIZED", "FORBIDDEN", "NOT_READY", "REQUESTER_UNRESOLVED", "DESTINATION_REJECTED", "DESTINATION_UNAVAILABLE", "INTERNAL"]


class ToolErrorBody(TypedDict):
    code: ToolErrorCode
    message: str
    """Safe to show the requester: no credentials, stack traces or upstream payloads."""
    retryable: bool
    """Whether the same call may succeed later unchanged."""


class ToolError(TypedDict):
    """Sent as the JSON text of an isError result, never as structuredContent: an MCP client validates structuredContent against the success outputSchema."""
    error: ToolErrorBody


class ServiceTokenClaims(TypedDict):
    """Payload of the HS256 JWT a host sends as Authorization: Bearer on every HTTP request."""
    iss: str
    aud: str
    sub: NotRequired[str]
    """The requester's userId. Required for intake:create and intake_get_task_status."""
    task_ids_sha256: NotRequired[str]
    """The task ids the host found owned by sub, as the base64url SHA-256 of the exact taskIds array it sends, serialised as compact JSON. Required for intake_get_task_status."""
    scope: str
    """Space-separated: intake:read, intake:create."""
    iat: int
    exp: int
    jti: str


TOOL_CONTRACTS: list[dict[str, Any]] = json.loads(
    r'''[
  {
    "name": "intake_get_team_descriptor",
    "title": "Team descriptor",
    "description": "This team's identity, intake fields and readiness rules.",
    "scope": "intake:read",
    "readOnly": true,
    "required": true,
    "inputSchema": {
      "type": "object",
      "properties": {}
    },
    "outputSchema": {
      "type": "object",
      "required": [
        "contractVersion",
        "team",
        "fields",
        "readinessNotes"
      ],
      "properties": {
        "contractVersion": {
          "type": "string",
          "pattern": "^2\\.\\d+$"
        },
        "team": {
          "$ref": "#/definitions/TeamIdentity"
        },
        "fields": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/TeamField"
          },
          "maxItems": 25
        },
        "readinessNotes": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 500
          },
          "maxItems": 10
        }
      },
      "definitions": {
        "TeamField": {
          "type": "object",
          "required": [
            "key",
            "label",
            "description",
            "kind",
            "required"
          ],
          "properties": {
            "key": {
              "type": "string",
              "pattern": "^[a-zA-Z][a-zA-Z0-9_]*$",
              "maxLength": 64
            },
            "label": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "description": {
              "type": "string",
              "maxLength": 500
            },
            "kind": {
              "type": "string",
              "enum": [
                "text",
                "longText",
                "enum"
              ]
            },
            "required": {
              "type": "boolean"
            },
            "options": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "maxItems": 25
            }
          }
        },
        "TeamIdentity": {
          "type": "object",
          "required": [
            "key",
            "title",
            "subtitle"
          ],
          "properties": {
            "key": {
              "type": "string",
              "pattern": "^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$",
              "maxLength": 32
            },
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "subtitle": {
              "type": "string",
              "maxLength": 500
            }
          }
        }
      }
    }
  },
  {
    "name": "intake_validate_definition_of_ready",
    "title": "Definition of Ready",
    "description": "Whether a draft meets this team's Definition of Ready.",
    "scope": "intake:read",
    "readOnly": true,
    "required": true,
    "inputSchema": {
      "type": "object",
      "required": [
        "draft"
      ],
      "properties": {
        "draft": {
          "$ref": "#/definitions/IntakeDraft"
        }
      },
      "definitions": {
        "IntakeCoreFields": {
          "type": "object",
          "required": [
            "title",
            "whatNeeded",
            "urgency",
            "businessValue",
            "approver"
          ],
          "properties": {
            "title": {
              "$ref": "#/definitions/NullableText"
            },
            "whatNeeded": {
              "$ref": "#/definitions/NullableText"
            },
            "urgency": {
              "$ref": "#/definitions/NullableText"
            },
            "businessValue": {
              "$ref": "#/definitions/NullableText"
            },
            "approver": {
              "$ref": "#/definitions/NullableText"
            }
          }
        },
        "IntakeDraft": {
          "type": "object",
          "required": [
            "core",
            "fieldValues",
            "requester"
          ],
          "properties": {
            "core": {
              "$ref": "#/definitions/IntakeCoreFields"
            },
            "fieldValues": {
              "type": "object",
              "additionalProperties": {
                "type": "string",
                "maxLength": 5000
              }
            },
            "requester": {
              "$ref": "#/definitions/IntakeRequester"
            }
          }
        },
        "IntakeRequester": {
          "type": "object",
          "description": "Who asked, as shown on a draft. Display data only: the identity a department may act on is TaskRequester, sent with creation.",
          "required": [
            "displayName",
            "department"
          ],
          "properties": {
            "displayName": {
              "$ref": "#/definitions/NullableText"
            },
            "department": {
              "$ref": "#/definitions/NullableText"
            }
          }
        },
        "NullableText": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "required": [
        "ready",
        "blockers",
        "warnings"
      ],
      "properties": {
        "ready": {
          "type": "boolean"
        },
        "blockers": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/ReadinessIssue"
          },
          "maxItems": 25
        },
        "warnings": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/ReadinessIssue"
          },
          "maxItems": 25
        }
      },
      "definitions": {
        "ReadinessIssue": {
          "type": "object",
          "required": [
            "message"
          ],
          "properties": {
            "field": {
              "type": "string"
            },
            "message": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            }
          }
        }
      }
    }
  },
  {
    "name": "intake_render_ticket",
    "title": "Render ticket",
    "description": "Renders the ticket body in this team's own template, for the requester to preview.",
    "scope": "intake:read",
    "readOnly": true,
    "required": true,
    "inputSchema": {
      "type": "object",
      "required": [
        "draft"
      ],
      "properties": {
        "draft": {
          "$ref": "#/definitions/IntakeDraft"
        }
      },
      "definitions": {
        "IntakeCoreFields": {
          "type": "object",
          "required": [
            "title",
            "whatNeeded",
            "urgency",
            "businessValue",
            "approver"
          ],
          "properties": {
            "title": {
              "$ref": "#/definitions/NullableText"
            },
            "whatNeeded": {
              "$ref": "#/definitions/NullableText"
            },
            "urgency": {
              "$ref": "#/definitions/NullableText"
            },
            "businessValue": {
              "$ref": "#/definitions/NullableText"
            },
            "approver": {
              "$ref": "#/definitions/NullableText"
            }
          }
        },
        "IntakeDraft": {
          "type": "object",
          "required": [
            "core",
            "fieldValues",
            "requester"
          ],
          "properties": {
            "core": {
              "$ref": "#/definitions/IntakeCoreFields"
            },
            "fieldValues": {
              "type": "object",
              "additionalProperties": {
                "type": "string",
                "maxLength": 5000
              }
            },
            "requester": {
              "$ref": "#/definitions/IntakeRequester"
            }
          }
        },
        "IntakeRequester": {
          "type": "object",
          "description": "Who asked, as shown on a draft. Display data only: the identity a department may act on is TaskRequester, sent with creation.",
          "required": [
            "displayName",
            "department"
          ],
          "properties": {
            "displayName": {
              "$ref": "#/definitions/NullableText"
            },
            "department": {
              "$ref": "#/definitions/NullableText"
            }
          }
        },
        "NullableText": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "required": [
        "description"
      ],
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 30000
        },
        "summary": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      }
    }
  },
  {
    "name": "intake_create_task",
    "title": "Create task",
    "description": "Creates the task for a confirmed draft, wherever this team keeps its work. Idempotent per idempotencyKey. Called by the host only.",
    "scope": "intake:create",
    "readOnly": false,
    "required": true,
    "inputSchema": {
      "type": "object",
      "required": [
        "idempotencyKey",
        "draft",
        "requester"
      ],
      "properties": {
        "idempotencyKey": {
          "type": "string",
          "description": "Stable for every attempt at one request. A department must return the same task for a key it has already created.",
          "pattern": "^[A-Za-z0-9._:-]{1,128}$"
        },
        "draft": {
          "$ref": "#/definitions/IntakeDraft"
        },
        "requester": {
          "$ref": "#/definitions/TaskRequester"
        }
      },
      "definitions": {
        "IntakeCoreFields": {
          "type": "object",
          "required": [
            "title",
            "whatNeeded",
            "urgency",
            "businessValue",
            "approver"
          ],
          "properties": {
            "title": {
              "$ref": "#/definitions/NullableText"
            },
            "whatNeeded": {
              "$ref": "#/definitions/NullableText"
            },
            "urgency": {
              "$ref": "#/definitions/NullableText"
            },
            "businessValue": {
              "$ref": "#/definitions/NullableText"
            },
            "approver": {
              "$ref": "#/definitions/NullableText"
            }
          }
        },
        "IntakeDraft": {
          "type": "object",
          "required": [
            "core",
            "fieldValues",
            "requester"
          ],
          "properties": {
            "core": {
              "$ref": "#/definitions/IntakeCoreFields"
            },
            "fieldValues": {
              "type": "object",
              "additionalProperties": {
                "type": "string",
                "maxLength": 5000
              }
            },
            "requester": {
              "$ref": "#/definitions/IntakeRequester"
            }
          }
        },
        "IntakeRequester": {
          "type": "object",
          "description": "Who asked, as shown on a draft. Display data only: the identity a department may act on is TaskRequester, sent with creation.",
          "required": [
            "displayName",
            "department"
          ],
          "properties": {
            "displayName": {
              "$ref": "#/definitions/NullableText"
            },
            "department": {
              "$ref": "#/definitions/NullableText"
            }
          }
        },
        "NullableText": {
          "type": [
            "string",
            "null"
          ]
        },
        "TaskRequester": {
          "type": "object",
          "description": "The authenticated requester, resolved by the host from its own records. Over HTTP, userId must equal the service token's sub claim.",
          "required": [
            "userId",
            "email"
          ],
          "properties": {
            "userId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "email": {
              "$ref": "#/definitions/NullableText"
            }
          }
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "required": [
        "task"
      ],
      "properties": {
        "task": {
          "$ref": "#/definitions/TaskReference"
        }
      },
      "definitions": {
        "TaskReference": {
          "type": "object",
          "required": [
            "id",
            "displayKey",
            "url",
            "location"
          ],
          "properties": {
            "id": {
              "type": "string",
              "description": "The department's own id for the task. The host passes it back to intake_get_task_status.",
              "minLength": 1,
              "maxLength": 256
            },
            "displayKey": {
              "type": "string",
              "description": "What the requester sees, e.g. PROJ-123.",
              "minLength": 1,
              "maxLength": 64
            },
            "url": {
              "type": [
                "string",
                "null"
              ],
              "description": "An http(s) link to the task, or null when it has none.",
              "pattern": "^https?://",
              "maxLength": 2048
            },
            "location": {
              "type": [
                "string",
                "null"
              ],
              "description": "Where the task was filed, in the department's words: a board, queue or label.",
              "maxLength": 500
            }
          }
        }
      }
    }
  },
  {
    "name": "intake_get_task_status",
    "title": "Task status",
    "description": "The current state of tasks this team created.",
    "scope": "intake:read",
    "readOnly": true,
    "required": false,
    "inputSchema": {
      "type": "object",
      "required": [
        "taskIds"
      ],
      "properties": {
        "taskIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "minItems": 1,
          "maxItems": 50
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "description": "One entry per task the department knows. An id it does not know is left out.",
      "required": [
        "statuses"
      ],
      "properties": {
        "statuses": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/TaskStatus"
          },
          "maxItems": 50
        }
      },
      "definitions": {
        "TaskStatus": {
          "type": "object",
          "required": [
            "taskId",
            "category",
            "label",
            "assignee",
            "lastChangedAt"
          ],
          "properties": {
            "taskId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256
            },
            "category": {
              "type": "string",
              "enum": [
                "todo",
                "in_progress",
                "done"
              ]
            },
            "label": {
              "type": "string",
              "description": "The department's own wording for the state.",
              "minLength": 1,
              "maxLength": 100
            },
            "assignee": {
              "type": [
                "string",
                "null"
              ],
              "maxLength": 200
            },
            "lastChangedAt": {
              "type": [
                "string",
                "null"
              ],
              "description": "ISO-8601, when the department last changed the task.",
              "maxLength": 64
            }
          }
        }
      }
    }
  }
]'''
)
