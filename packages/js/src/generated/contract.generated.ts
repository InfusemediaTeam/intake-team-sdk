// Generated from spec/ and the package.json version by scripts/generate-contract.mjs. Do not edit.

export const SDK_VERSION = '2.0.0';

export const CONTRACT_VERSION = '2.0';

export const RESERVED_TOOL_PREFIX = 'intake_';

export const SCOPES = { read: 'intake:read', create: 'intake:create' } as const;

export const SERVICE_TOKEN_RULES = {
  algorithm: 'HS256',
  minSecretLength: 32,
  maxLifetimeSeconds: 300,
  clockToleranceSeconds: 30,
} as const;

export interface ITeamIdentity {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
}

export interface ITeamField {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly kind: 'text' | 'longText' | 'enum';
  readonly required: boolean;
  readonly options?: readonly string[];
}

export interface ITeamDescriptor {
  readonly contractVersion: string;
  readonly team: ITeamIdentity;
  readonly fields: readonly ITeamField[];
  readonly readinessNotes: readonly string[];
}

export type NullableText = string | null;

export interface IIntakeCoreFields {
  readonly title: NullableText;
  readonly whatNeeded: NullableText;
  readonly urgency: NullableText;
  readonly businessValue: NullableText;
  readonly approver: NullableText;
}

/** Who asked, as shown on a draft. Display data only: the identity a department may act on is TaskRequester, sent with creation. */
export interface IIntakeRequester {
  readonly displayName: NullableText;
  readonly department: NullableText;
}

export interface IIntakeDraft {
  readonly core: IIntakeCoreFields;
  readonly fieldValues: Readonly<Record<string, string>>;
  readonly requester: IIntakeRequester;
}

export type IEmptyInput = Readonly<Record<string, never>>;

export interface IDraftInput {
  readonly draft: IIntakeDraft;
}

export interface IReadinessIssue {
  readonly field?: string;
  readonly message: string;
}

export interface IReadinessVerdict {
  readonly ready: boolean;
  readonly blockers: readonly IReadinessIssue[];
  readonly warnings: readonly IReadinessIssue[];
}

export interface IRenderedTicket {
  readonly description: string;
  readonly summary?: string;
}

/** The authenticated requester, resolved by the host from its own records. Over HTTP, userId must equal the service token's sub claim. */
export interface ITaskRequester {
  readonly userId: string;
  readonly email: NullableText;
}

export interface ICreateTaskInput {
  /** Stable for every attempt at one request. A department must return the same task for a key it has already created. */
  readonly idempotencyKey: string;
  readonly draft: IIntakeDraft;
  readonly requester: ITaskRequester;
}

export interface ITaskReference {
  /** The department's own id for the task. The host passes it back to intake_get_task_status. */
  readonly id: string;
  /** What the requester sees, e.g. PROJ-123. */
  readonly displayKey: string;
  /** An http(s) link to the task, or null when it has none. */
  readonly url: string | null;
  /** Where the task was filed, in the department's words: a board, queue or label. */
  readonly location: string | null;
}

export interface ICreateTaskResult {
  readonly task: ITaskReference;
}

export interface ITaskStatusInput {
  readonly taskIds: readonly string[];
}

export interface ITaskStatus {
  readonly taskId: string;
  readonly category: 'todo' | 'in_progress' | 'done';
  /** The department's own wording for the state. */
  readonly label: string;
  readonly assignee: string | null;
  /** ISO-8601, when the department last changed the task. */
  readonly lastChangedAt: string | null;
}

/** One entry per task the department knows. An id it does not know is left out. */
export interface ITaskStatusResult {
  readonly statuses: readonly ITaskStatus[];
}

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_READY'
  | 'REQUESTER_UNRESOLVED'
  | 'DESTINATION_REJECTED'
  | 'DESTINATION_UNAVAILABLE'
  | 'INTERNAL';

/** Sent as the JSON text of an isError result, never as structuredContent: an MCP client validates structuredContent against the success outputSchema. */
export interface IToolError {
  readonly error: IToolErrorBody;
}

export interface IToolErrorBody {
  readonly code: ToolErrorCode;
  /** Safe to show the requester: no credentials, stack traces or upstream payloads. */
  readonly message: string;
  /** Whether the same call may succeed later unchanged. */
  readonly retryable: boolean;
}

/** Payload of the HS256 JWT a host sends as Authorization: Bearer on every HTTP request. */
export interface IServiceTokenClaims {
  readonly iss: string;
  readonly aud: string;
  /** The requester's userId. Required for intake:create and intake_get_task_status. */
  readonly sub?: string;
  /** The task ids the host found owned by sub, as the base64url SHA-256 of the exact taskIds array it sends, serialised as compact JSON. Required for intake_get_task_status. */
  readonly task_ids_sha256?: string;
  /** Space-separated: intake:read, intake:create. */
  readonly scope: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

export interface IToolContract {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly scope: string;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export const TOOL_CONTRACTS: readonly IToolContract[] = [
  {
    name: 'intake_get_team_descriptor',
    title: 'Team descriptor',
    description: "This team's identity, intake fields and readiness rules.",
    scope: 'intake:read',
    readOnly: true,
    required: true,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      required: ['contractVersion', 'team', 'fields', 'readinessNotes'],
      properties: {
        contractVersion: { type: 'string', pattern: '^2\\.\\d+$' },
        team: { $ref: '#/definitions/TeamIdentity' },
        fields: {
          type: 'array',
          items: { $ref: '#/definitions/TeamField' },
          maxItems: 25,
        },
        readinessNotes: {
          type: 'array',
          items: { type: 'string', maxLength: 500 },
          maxItems: 10,
        },
      },
      definitions: {
        TeamField: {
          type: 'object',
          required: ['key', 'label', 'description', 'kind', 'required'],
          properties: {
            key: {
              type: 'string',
              pattern: '^[a-zA-Z][a-zA-Z0-9_]*$',
              maxLength: 64,
            },
            label: { type: 'string', minLength: 1, maxLength: 500 },
            description: { type: 'string', maxLength: 500 },
            kind: { type: 'string', enum: ['text', 'longText', 'enum'] },
            required: { type: 'boolean' },
            options: {
              type: 'array',
              items: { type: 'string', minLength: 1, maxLength: 500 },
              maxItems: 25,
            },
          },
        },
        TeamIdentity: {
          type: 'object',
          required: ['key', 'title', 'subtitle'],
          properties: {
            key: {
              type: 'string',
              pattern: '^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$',
              maxLength: 32,
            },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            subtitle: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
  },
  {
    name: 'intake_validate_definition_of_ready',
    title: 'Definition of Ready',
    description: "Whether a draft meets this team's Definition of Ready.",
    scope: 'intake:read',
    readOnly: true,
    required: true,
    inputSchema: {
      type: 'object',
      required: ['draft'],
      properties: { draft: { $ref: '#/definitions/IntakeDraft' } },
      definitions: {
        IntakeCoreFields: {
          type: 'object',
          required: [
            'title',
            'whatNeeded',
            'urgency',
            'businessValue',
            'approver',
          ],
          properties: {
            title: { $ref: '#/definitions/NullableText' },
            whatNeeded: { $ref: '#/definitions/NullableText' },
            urgency: { $ref: '#/definitions/NullableText' },
            businessValue: { $ref: '#/definitions/NullableText' },
            approver: { $ref: '#/definitions/NullableText' },
          },
        },
        IntakeDraft: {
          type: 'object',
          required: ['core', 'fieldValues', 'requester'],
          properties: {
            core: { $ref: '#/definitions/IntakeCoreFields' },
            fieldValues: {
              type: 'object',
              additionalProperties: { type: 'string', maxLength: 5000 },
            },
            requester: { $ref: '#/definitions/IntakeRequester' },
          },
        },
        IntakeRequester: {
          type: 'object',
          description:
            'Who asked, as shown on a draft. Display data only: the identity a department may act on is TaskRequester, sent with creation.',
          required: ['displayName', 'department'],
          properties: {
            displayName: { $ref: '#/definitions/NullableText' },
            department: { $ref: '#/definitions/NullableText' },
          },
        },
        NullableText: { type: ['string', 'null'] },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['ready', 'blockers', 'warnings'],
      properties: {
        ready: { type: 'boolean' },
        blockers: {
          type: 'array',
          items: { $ref: '#/definitions/ReadinessIssue' },
          maxItems: 25,
        },
        warnings: {
          type: 'array',
          items: { $ref: '#/definitions/ReadinessIssue' },
          maxItems: 25,
        },
      },
      definitions: {
        ReadinessIssue: {
          type: 'object',
          required: ['message'],
          properties: {
            field: { type: 'string' },
            message: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
  },
  {
    name: 'intake_render_ticket',
    title: 'Render ticket',
    description:
      "Renders the ticket body in this team's own template, for the requester to preview.",
    scope: 'intake:read',
    readOnly: true,
    required: true,
    inputSchema: {
      type: 'object',
      required: ['draft'],
      properties: { draft: { $ref: '#/definitions/IntakeDraft' } },
      definitions: {
        IntakeCoreFields: {
          type: 'object',
          required: [
            'title',
            'whatNeeded',
            'urgency',
            'businessValue',
            'approver',
          ],
          properties: {
            title: { $ref: '#/definitions/NullableText' },
            whatNeeded: { $ref: '#/definitions/NullableText' },
            urgency: { $ref: '#/definitions/NullableText' },
            businessValue: { $ref: '#/definitions/NullableText' },
            approver: { $ref: '#/definitions/NullableText' },
          },
        },
        IntakeDraft: {
          type: 'object',
          required: ['core', 'fieldValues', 'requester'],
          properties: {
            core: { $ref: '#/definitions/IntakeCoreFields' },
            fieldValues: {
              type: 'object',
              additionalProperties: { type: 'string', maxLength: 5000 },
            },
            requester: { $ref: '#/definitions/IntakeRequester' },
          },
        },
        IntakeRequester: {
          type: 'object',
          description:
            'Who asked, as shown on a draft. Display data only: the identity a department may act on is TaskRequester, sent with creation.',
          required: ['displayName', 'department'],
          properties: {
            displayName: { $ref: '#/definitions/NullableText' },
            department: { $ref: '#/definitions/NullableText' },
          },
        },
        NullableText: { type: ['string', 'null'] },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['description'],
      properties: {
        description: { type: 'string', minLength: 1, maxLength: 30000 },
        summary: { type: 'string', minLength: 1, maxLength: 500 },
      },
    },
  },
  {
    name: 'intake_create_task',
    title: 'Create task',
    description:
      'Creates the task for a confirmed draft, wherever this team keeps its work. Idempotent per idempotencyKey. Called by the host only.',
    scope: 'intake:create',
    readOnly: false,
    required: true,
    inputSchema: {
      type: 'object',
      required: ['idempotencyKey', 'draft', 'requester'],
      properties: {
        idempotencyKey: {
          type: 'string',
          description:
            'Stable for every attempt at one request. A department must return the same task for a key it has already created.',
          pattern: '^[A-Za-z0-9._:-]{1,128}$',
        },
        draft: { $ref: '#/definitions/IntakeDraft' },
        requester: { $ref: '#/definitions/TaskRequester' },
      },
      definitions: {
        IntakeCoreFields: {
          type: 'object',
          required: [
            'title',
            'whatNeeded',
            'urgency',
            'businessValue',
            'approver',
          ],
          properties: {
            title: { $ref: '#/definitions/NullableText' },
            whatNeeded: { $ref: '#/definitions/NullableText' },
            urgency: { $ref: '#/definitions/NullableText' },
            businessValue: { $ref: '#/definitions/NullableText' },
            approver: { $ref: '#/definitions/NullableText' },
          },
        },
        IntakeDraft: {
          type: 'object',
          required: ['core', 'fieldValues', 'requester'],
          properties: {
            core: { $ref: '#/definitions/IntakeCoreFields' },
            fieldValues: {
              type: 'object',
              additionalProperties: { type: 'string', maxLength: 5000 },
            },
            requester: { $ref: '#/definitions/IntakeRequester' },
          },
        },
        IntakeRequester: {
          type: 'object',
          description:
            'Who asked, as shown on a draft. Display data only: the identity a department may act on is TaskRequester, sent with creation.',
          required: ['displayName', 'department'],
          properties: {
            displayName: { $ref: '#/definitions/NullableText' },
            department: { $ref: '#/definitions/NullableText' },
          },
        },
        NullableText: { type: ['string', 'null'] },
        TaskRequester: {
          type: 'object',
          description:
            "The authenticated requester, resolved by the host from its own records. Over HTTP, userId must equal the service token's sub claim.",
          required: ['userId', 'email'],
          properties: {
            userId: { type: 'string', minLength: 1, maxLength: 128 },
            email: { $ref: '#/definitions/NullableText' },
          },
        },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['task'],
      properties: { task: { $ref: '#/definitions/TaskReference' } },
      definitions: {
        TaskReference: {
          type: 'object',
          required: ['id', 'displayKey', 'url', 'location'],
          properties: {
            id: {
              type: 'string',
              description:
                "The department's own id for the task. The host passes it back to intake_get_task_status.",
              minLength: 1,
              maxLength: 256,
            },
            displayKey: {
              type: 'string',
              description: 'What the requester sees, e.g. PROJ-123.',
              minLength: 1,
              maxLength: 64,
            },
            url: {
              type: ['string', 'null'],
              description:
                'An http(s) link to the task, or null when it has none.',
              pattern: '^https?://',
              maxLength: 2048,
            },
            location: {
              type: ['string', 'null'],
              description:
                "Where the task was filed, in the department's words: a board, queue or label.",
              maxLength: 500,
            },
          },
        },
      },
    },
  },
  {
    name: 'intake_get_task_status',
    title: 'Task status',
    description: 'The current state of tasks this team created.',
    scope: 'intake:read',
    readOnly: true,
    required: false,
    inputSchema: {
      type: 'object',
      required: ['taskIds'],
      properties: {
        taskIds: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 256 },
          minItems: 1,
          maxItems: 50,
        },
      },
    },
    outputSchema: {
      type: 'object',
      description:
        'One entry per task the department knows. An id it does not know is left out.',
      required: ['statuses'],
      properties: {
        statuses: {
          type: 'array',
          items: { $ref: '#/definitions/TaskStatus' },
          maxItems: 50,
        },
      },
      definitions: {
        TaskStatus: {
          type: 'object',
          required: [
            'taskId',
            'category',
            'label',
            'assignee',
            'lastChangedAt',
          ],
          properties: {
            taskId: { type: 'string', minLength: 1, maxLength: 256 },
            category: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
            label: {
              type: 'string',
              description: "The department's own wording for the state.",
              minLength: 1,
              maxLength: 100,
            },
            assignee: { type: ['string', 'null'], maxLength: 200 },
            lastChangedAt: {
              type: ['string', 'null'],
              description:
                'ISO-8601, when the department last changed the task.',
              maxLength: 64,
            },
          },
        },
      },
    },
  },
];
