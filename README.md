# intake-team-sdk

A toolkit for building **intake MCP servers**: one [Model Context
Protocol](https://modelcontextprotocol.io) server per department, each of which
tells an intake host what its department asks for, whether a request is ready,
how its ticket reads — and then **creates the task itself**, wherever that
department keeps its work.

The SDK is the department-independent half of that, in two languages built from
one contract:

| Path               | What                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `spec/`            | The contract: JSON Schema (`intake-contract.schema.json`), tool list, fixtures                           |
| `packages/js/`     | The JavaScript/TypeScript SDK's source, tests and TypeScript config                                      |
| `packages/python/` | The Python SDK (`intake_team_sdk`) — see [packages/python/README.md](packages/python/README.md)          |
| `scripts/`         | `generate-contract.mjs`, which generates both SDKs' contract code from `spec/`                           |
| `package.json`     | The JavaScript SDK's npm manifest. It stays at the root because npm installs a Git dependency from there |

It knows nothing about any particular department, and nothing about Jira.

## What it provides (JavaScript/TypeScript)

| Area           | Exports                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract       | `INTAKE_CONTRACT_VERSION` (`2.0`), the five tool names, `CONTRACT_TOOL_NAMES`, `CONTRACT_TOOL_PREFIX`, `READ_SCOPE`/`CREATE_SCOPE`, `TOOL_CONTRACTS` (each tool's input/output schema), and the generated types    |
| Server         | `createTeamServer(definition, { caller })` — one `ITeamDefinition` published as an MCP server                                                                 |
| Transports     | `runStdioTeamServer(definition)`, `runHttpTeamServer(definition, { port, auth })`                                                                             |
| Authentication | HS256 service tokens: `verifyServiceToken`, `signServiceToken`, `taskIdsDigest`, `ServiceTokenError`, `serviceAuthFromEnv(prefix)`; enforced by the HTTP transport |
| Tasks          | `TaskError(code, message, retryable = false)` for failures the requester should hear about                                                                            |
| Drafts         | `toIntakeDraft` (tolerant parsing), `filled`, `fieldValue`, `draftProse`, `includesAny`                                                                       |
| Readiness      | `readiness(draft)` — a chainable report that collects blockers and warnings                                                                                   |
| Rendering      | `section`, `bullets`, `labelled`, `compose` for a markdown ticket body                                                                                        |
| Configuration  | `requiredEnv`, `requiredEnvList`, `readPairs`                                                                                                                 |

## What it does not provide

- **No department rules.** No fields, readiness conditions, templates or
  destinations.
- **No task system.** The SDK never talks to Jira or anything else. A department
  that keeps its work in Jira, or any other tracker, brings its own client.
- **No configuration values.** Every environment variable it reads is one the
  caller names; it holds no URLs, tokens or credentials.

## The contract

`spec/intake-contract.schema.json` (JSON Schema draft-07) is the single source of
truth. `spec/contract.json` lists the tools, which definition each takes and
returns, and the service-token rules. `npm run generate` turns them into
`packages/js/src/generated/contract.generated.ts` (TypeScript interfaces and
per-tool schemas) and `packages/python/src/intake_team_sdk/_generated.py`
(TypedDicts and the same
schemas); both are committed, and `npm run check:generated` fails when either is
stale. Do not edit either by hand: change `spec/` and run `npm run generate`.
`spec/fixtures/` holds the values and tokens both SDKs' tests must judge
identically.

A server publishes these tools, with the schemas from `spec/` as each tool's
`inputSchema` and `outputSchema`. The whole `intake_` prefix is reserved: a host
calls these tools itself and must **never** expose them to a model.

| Tool                                  | Takes                                       | Returns                                             | Required |
| ------------------------------------- | ------------------------------------------- | --------------------------------------------------- | -------- |
| `intake_get_team_descriptor`          | —                                           | identity, fields, readiness notes                   | yes      |
| `intake_validate_definition_of_ready` | `{ draft }`                                 | `{ ready, blockers[], warnings[] }`                 | yes      |
| `intake_render_ticket`                | `{ draft }`                                 | `{ description, summary? }` — the requester preview | yes      |
| `intake_create_task`                  | `{ idempotencyKey, draft, requester }`      | `{ task: { id, displayKey, url, location } }`       | yes      |
| `intake_get_task_status`              | `{ taskIds }` (1–50)                        | `{ statuses: [{ taskId, category, label, assignee, lastChangedAt }] }` | no |

- `requester` is `{ userId, email }` (`email` a string or `null`, never absent), resolved by the host from its own records.
  The draft itself only carries a display name and department.
- `task.url` is an `http(s)` link or `null`; `task.location` says where it was
  filed (a board, queue or label) or is `null`.
- `category` is one of `todo`, `in_progress`, `done`; `label` is the
  department's own wording. A status for an id the department does not know is
  left out.

### Errors

A failure is an MCP result with `isError: true` whose text content is the JSON
`{ "error": { "code", "message", "retryable" } }` — never `structuredContent`,
which a client validates against the success schema. Codes: `INVALID_INPUT`,
`UNAUTHORIZED`, `FORBIDDEN`, `NOT_READY`, `REQUESTER_UNRESOLVED`,
`DESTINATION_REJECTED`, `DESTINATION_UNAVAILABLE`, `INTERNAL`.

Throw `TaskError` from your handlers to report one; its message must be safe to
show a requester. Anything else thrown is logged to stderr (message only) and
reported as `INTERNAL`, retryable, with a generic message.

### Idempotency

`idempotencyKey` is the same for every attempt at one request. **Your
`createTask` must return the task it already created for a key it has seen**,
from your own storage (for example, label each task `intake-id-<key>` in your
tracker and search for that label before creating). The SDK also merges concurrent calls
with the same requester and key inside one process, but only your storage can
recognise a task created before a restart or by another replica.

## Installing

Both SDKs install straight from this public repository at a Git tag. Nothing is
published to npm or PyPI.

> **Not tagged yet:** the newest tag is `v1.3.1`, which is the 1.x contract.
> Until `v2.0.0` is cut, the commands below fail; pin a commit (`#<sha>` for
> npm, `@<sha>` for pip) instead.

JavaScript/TypeScript — the source is in `packages/js/`, but the npm manifest
stays at the repository root: npm installs a Git dependency from the root and
has no way to install from a subdirectory. The root `package.json` builds
`packages/js/` and points `main` and `types` at its output:

```
npm install git+https://github.com/InfusemediaTeam/intake-team-sdk.git#v2.0.0
```

npm builds it from source on install (`prepare`). Node 24 or newer;
`@modelcontextprotocol/sdk` and `express` come with it.

Python 3.11 or newer — the package lives in `packages/python/`:

```
pip install "git+https://github.com/InfusemediaTeam/intake-team-sdk.git@v2.0.0#subdirectory=packages/python"
```

## A minimal department server

```ts
// example.team.ts
import {
  INTAKE_CONTRACT_VERSION,
  TaskError,
  compose,
  fieldValue,
  readiness,
  section,
} from 'intake-team-sdk';
import type { ITeamDefinition, ITaskReference } from 'intake-team-sdk';

/** Stand-in storage; a real department uses its own task system. */
const tasksByKey = new Map<string, ITaskReference>();

export const EXAMPLE_TEAM: ITeamDefinition = {
  descriptor: {
    contractVersion: INTAKE_CONTRACT_VERSION,
    team: { key: 'EXAMPLE', title: 'Example department', subtitle: 'What it does' },
    fields: [
      {
        key: 'affectedSystem',
        label: 'Affected system',
        description: 'The system this is about.',
        kind: 'text',
        required: true,
      },
    ],
    readinessNotes: [],
  },

  validate: (draft) =>
    readiness(draft)
      .requireCore('title', 'The ticket needs a short title.')
      .requireField('affectedSystem', 'Name the affected system.')
      .verdict(),

  render: (draft) => ({
    description: compose([
      section('What is needed', draft.core.whatNeeded),
      section('Affected system', fieldValue(draft, 'affectedSystem')),
    ]),
  }),

  // Called only after the draft passed `validate` again and the caller was
  // authorized. Must be idempotent on `input.idempotencyKey`.
  createTask: async (input) => {
    const existing = tasksByKey.get(input.idempotencyKey);

    if (existing) return { task: existing };
    if (!input.requester.email) {
      throw new TaskError('REQUESTER_UNRESOLVED', 'We could not identify you.');
    }

    const task: ITaskReference = {
      id: String(tasksByKey.size + 1),
      displayKey: `EX-${tasksByKey.size + 1}`,
      url: null,
      location: 'Example queue',
    };

    tasksByKey.set(input.idempotencyKey, task);

    return { task };
  },

  // Optional: without it the host shows the status as unavailable.
  getTaskStatus: async (taskIds) => ({
    statuses: [...tasksByKey.values()]
      .filter((task) => taskIds.includes(task.id))
      .map((task) => ({
        taskId: task.id,
        category: 'todo' as const,
        label: 'Open',
        assignee: null,
        lastChangedAt: null,
      })),
  }),
};
```

The entry point is only a transport choice:

```ts
// main.ts — stdio, for a host that spawns the server as a child process
import { runStdioTeamServer } from 'intake-team-sdk';
import { EXAMPLE_TEAM } from './example.team';

void runStdioTeamServer(EXAMPLE_TEAM);
```

```ts
// main.ts — streamable HTTP, for a host that reaches the server over a network
import { runHttpTeamServer, serviceAuthFromEnv } from 'intake-team-sdk';
import { EXAMPLE_TEAM } from './example.team';

const listener = runHttpTeamServer(EXAMPLE_TEAM, {
  port: Number(process.env.EXAMPLE_MCP_PORT ?? 3000),
  // EXAMPLE_MCP_JWT_SECRET, EXAMPLE_MCP_JWT_ISSUER, EXAMPLE_MCP_JWT_AUDIENCE
  auth: serviceAuthFromEnv('EXAMPLE'),
});

process.once('SIGTERM', () => listener.close());
```

`runHttpTeamServer` serves `POST /mcp` and answers `GET /health` with the
department key (both paths overridable). It is stateless, returns the
`http.Server`, and installs no signal handlers unless you pass
`handleSignals: true`. It listens on every interface (there is no host option,
unlike the Python SDK, which defaults to `127.0.0.1`).

## Service tokens and the requester

Over HTTP every request must carry `Authorization: Bearer <jwt>`: an HS256 token
the host signs per request with a secret it shares with **this department
only**. The check runs before the body is parsed; any failure is a `401` with a
JSON-RPC `Unauthorized` body, and the reason is not disclosed. Checked:

- algorithm pinned to HS256 and the signature (constant-time);
- `iss` and `aud` equal to your configured issuer and audience;
- integer `exp` and `iat` within 30 seconds of clock tolerance, and a lifetime of
  at most 300 seconds;
- `jti` and `scope` present; `sub`, if present, non-empty; `task_ids_sha256`,
  if present, a base64url SHA-256.

Tokens are not single-use: no `jti` is remembered, so a token is accepted again
until it expires. Keep the HTTP leg on TLS and token lifetimes short.

The verified caller then authorizes each call: `intake_create_task` needs the
`intake:create` scope, every other tool `intake:read`. **A create whose
`requester.userId` differs from the token's `sub` (or whose token has no `sub`)
is refused with `FORBIDDEN`**,
so whatever wrote the arguments cannot file a task under someone else.

**`intake_get_task_status` answers only the tasks the token was issued for.** The
host knows whose task is whose, so it signs the requester as `sub` and the ids it
found owned by them as `task_ids_sha256`: the base64url SHA-256 of the exact
`taskIds` array it sends, as compact JSON (`taskIdsDigest` computes it). A token
with no `sub`, no `task_ids_sha256`, or a digest that does not match the call's
own `taskIds` is refused with `FORBIDDEN` before your `getTaskStatus` runs, so a
token for discovery or a preview reads no task, and no id can be added to a call
after signing. Your handler should still only look where your own tasks live
(e.g. your own Jira project). The secret
must be at least 32 characters; a shorter one, or a blank issuer or audience,
stops the server starting.

Over stdio there is no token: only the host that spawned the process can write
to it, so every tool is allowed and `context.caller` is `null`.

The host is expected to take `userId` from its own authenticated records, never
from a model or a caller. Treat it as an identifier, not as permission to act
for that user.

## The integration flow

1. **Discover** — the host calls `tools/list` and `intake_get_team_descriptor`.
   A server without `intake_create_task` is not offered.
2. **Interview** — the host collects a draft; your fields and readiness notes
   shape what it asks.
3. **Check and preview** — `intake_validate_definition_of_ready` and
   `intake_render_ticket`, on every change. Keep both fast and free of network
   calls: a host bounds them and treats an overrun as the server being down.
4. **Create** — after the requester confirms, the host calls `intake_create_task`
   once per attempt, with the request's stable idempotency key. The SDK checks
   the caller, re-runs your `validate` (refusing with `NOT_READY` without calling
   you), merges concurrent duplicates, calls your `createTask`, and checks the
   reference you return.
5. **Track** — `intake_get_task_status` with the ids you returned.

In a stdio server stdout is the protocol: write diagnostics to stderr.

## Who implements what

|                                                                   | SDK | Department |
| ----------------------------------------------------------------- | --- | ---------- |
| MCP server, tool publishing and dispatch, schemas from `spec/`    | ✅  |            |
| stdio and streamable HTTP transports                              | ✅  |            |
| Service-token verification, scopes, requester/subject check       | ✅  |            |
| Readiness re-check before creation; concurrent-duplicate merging  | ✅  |            |
| Error results, and hiding unexpected errors                       | ✅  |            |
| Draft parsing, readiness bookkeeping, markdown primitives         | ✅  |            |
| Identity, fields, readiness rules, ticket template                |     | ✅         |
| Creating the task — destination, formatting, notifications        |     | ✅         |
| Idempotency across restarts, in its own storage                   |     | ✅         |
| Status lookup and its wording                                     |     | ✅         |
| Its own credentials and environment variables                     |     | ✅         |

## Migrating from 1.x

2.0 is a breaking release; the host must accept contract major 2 first.

- Remove `jira` from the descriptor and `customFields` from `render`'s result.
  Where tasks land is now decided inside `createTask`.
- Implement `createTask` (required) and, ideally, `getTaskStatus`.
- `jiraMappingFromEnv`, `jiraFieldIdsFromEnv` and `customField` are no longer in
  the SDK; keep equivalents in your own package if you still use Jira.
- `runHttpTeamServer` takes `auth: { secret, issuer, audience }` instead of
  `authToken`, and `isBearerAuthorized` is gone: the host now sends a signed,
  short-lived token rather than a static one.
- Team tools may not start with `intake_`, and `execute` may return a promise.

## Working on the SDK

```
npm run generate         # spec/ -> packages/js/src/generated + packages/python/src/intake_team_sdk/_generated.py
npm run check:generated  # fails when either generated file is stale
npm run build            # packages/js/tsconfig.build.json -> packages/js/dist/, src only
npm run typecheck
npm run lint
npm test                 # packages/js/tsconfig.json -> packages/js/dist-test/, then node:test over it
```

Python: see [packages/python/README.md](packages/python/README.md#tests). CI runs both on every
pull request and push to `main` (`.github/workflows/ci.yml`).

## License

MIT
