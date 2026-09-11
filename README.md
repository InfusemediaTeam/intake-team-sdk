# intake-team-sdk

A toolkit for building **intake MCP servers**: one [Model Context
Protocol](https://modelcontextprotocol.io) server per department, each of which
tells an intake host what its department asks for, whether a request is ready,
and how its ticket should read.

The SDK is the department-independent half of that. It knows the wire contract,
how to publish it as an MCP server, how to serve it over stdio or streamable
HTTP, and the handful of helpers every department was otherwise writing itself.
It knows nothing about any particular department.

## What it provides

| Area | Exports |
| --- | --- |
| Contract | `INTAKE_CONTRACT_VERSION`, the three reserved tool names, `CONTRACT_TOOL_NAMES`, and the types (`ITeamDescriptor`, `IIntakeDraft`, `IDefinitionOfReadyVerdict`, `IRenderedTicket`, …) |
| Server | `createTeamServer(definition)` — one `ITeamDefinition` published as an MCP server |
| Transports | `runStdioTeamServer(definition)`, `runHttpTeamServer(definition, { port, authToken })` |
| Authentication | Bearer-token checking on the HTTP transport, and `isBearerAuthorized` on its own |
| Drafts | `toIntakeDraft` (tolerant parsing of a tool call's arguments), `filled`, `fieldValue`, `draftProse`, `includesAny` |
| Readiness | `readiness(draft)` — a chainable report that collects blockers and warnings |
| Rendering | `section`, `bullets`, `labelled`, `compose` for a markdown ticket body |
| Configuration | `jiraMappingFromEnv(prefix, { issueType })`, `requiredEnv`, `requiredEnvList` |

## What it does not provide

- **No department rules.** No fields, no readiness conditions, no ticket
  templates, no keyword vocabularies, no issue-type or project defaults.
- **No department registry.** The SDK never learns which departments exist; a
  server serves exactly one, and the host decides which servers it talks to.
- **No outbound calls.** It does not talk to Jira or to anything else. A
  department declares *where* its tickets go and *what they say*; the host is
  what puts them there.
- **No configuration values.** Every environment variable it reads is one the
  caller names, and it holds no defaults for URLs, tokens or credentials.

## The contract

A server publishes three tools whose names are reserved. A host calls them
itself and is expected **not** to expose them to a model: a model able to call
its own readiness check can pass itself, and one able to render its own ticket
body can put anything on a board.

| Tool | Returns |
| --- | --- |
| `intake_get_team_descriptor` | Identity, Jira mapping, fields, and readiness notes |
| `intake_validate_definition_of_ready` | `{ ready, blockers[], warnings[] }` for one draft |
| `intake_render_ticket` | `{ description, summary? }` in the department's own template |

A department may publish **other** tools for the host's assistant to call — a
reference table, a classification guide. Declare them `readOnly: true`; a host
is expected to refuse to adapt a tool that does not.

`createTeamServer` throws if one of them takes a reserved name, or if two take
the same name as each other. Dispatch answers the contract names first, so such
a tool would be published and then never reached — a failure a caller cannot see
at runtime, so it stops startup instead.

Two conventions matter when writing rules:

- **A blocker is what the requester is asked for.** It is surfaced in the
  department's own words, so phrase it as an instruction, not an error code.
- **A warning must never be a question.** Warnings do not block, so use them for
  "this would help", not "this is needed".

## Installing

```
npm install intake-team-sdk
```

Node 24 or newer, TypeScript, CommonJS output. `@modelcontextprotocol/sdk` and
`express` come with it.

## A minimal department server

Two files. First the department — data plus two pure functions:

```ts
// example.team.ts
import {
  INTAKE_CONTRACT_VERSION,
  compose,
  fieldValue,
  filled,
  jiraMappingFromEnv,
  readiness,
  section,
} from 'intake-team-sdk';
import type { ITeamDefinition } from 'intake-team-sdk';

const SEVERITIES = ['Low', 'High'] as const;

export const EXAMPLE_TEAM: ITeamDefinition = {
  descriptor: {
    contractVersion: INTAKE_CONTRACT_VERSION,
    team: {
      key: 'EXAMPLE',
      title: 'Example department',
      subtitle: 'What this department does',
    },
    // Read from EXAMPLE_JIRA_PROJECT / EXAMPLE_JIRA_LABELS at module load.
    jira: jiraMappingFromEnv('EXAMPLE', { issueType: 'Task' }),
    fields: [
      {
        key: 'affectedSystem',
        label: 'Affected system',
        description: 'The system this is about.',
        kind: 'text',
        required: true,
      },
      {
        key: 'severity',
        label: 'Severity',
        description: 'How badly this bites.',
        kind: 'enum',
        required: true,
        options: SEVERITIES,
      },
    ],
    // Published so the host's assistant can ask up front, rather than the
    // requester discovering the rule when they are refused.
    readinessNotes: ['High severity requires a named approver.'],
  },

  validate: (draft) =>
    readiness(draft)
      .requireCore('title', 'The ticket needs a short title.')
      .requireCore('whatNeeded', 'Describe what needs to be done.')
      .requireField('affectedSystem', 'Name the affected system.')
      .requireEnumField('severity', SEVERITIES, {
        missing: `State the severity — one of: ${SEVERITIES.join(', ')}.`,
        invalid: (value) => `"${value}" is not a severity.`,
      })
      .blockWhen(
        fieldValue(draft, 'severity') === 'High' &&
          !filled(draft.core.approver),
        'approver',
        'High severity needs a named approver.',
      )
      .verdict(),

  render: (draft) => ({
    summary: draft.core.title ?? undefined,
    description: compose([
      section('What is needed', draft.core.whatNeeded),
      section('Affected system', fieldValue(draft, 'affectedSystem')),
      section('Severity', fieldValue(draft, 'severity')),
      section('Requested by', draft.requester.displayName),
    ]),
  }),
};
```

Then the entry point, which is only a transport choice:

```ts
// main.ts — stdio, for a host that spawns the server as a child process
import { runStdioTeamServer } from 'intake-team-sdk';

import { EXAMPLE_TEAM } from './example.team';

void runStdioTeamServer(EXAMPLE_TEAM);
```

```ts
// main.ts — streamable HTTP, for a host that reaches the server over a network
import { runHttpTeamServer } from 'intake-team-sdk';

import { EXAMPLE_TEAM } from './example.team';

runHttpTeamServer(EXAMPLE_TEAM, {
  port: Number(process.env.EXAMPLE_MCP_PORT ?? 3000),
  authToken: process.env.EXAMPLE_MCP_TOKEN ?? '',
});
```

`runHttpTeamServer` serves `POST /mcp` behind an `Authorization: Bearer <token>`
check and answers `GET /health` with the department key. A blank token throws
rather than starting: an unauthenticated intake endpoint is reachable by anyone
who can route to it, and the failure is silent. Both paths are overridable
(`path`, `healthPath`).

**Shutdown is yours.** It returns the `http.Server` and installs no signal
handlers; nothing in the SDK ends the process. Close the listener as part of
whatever shutdown your entry point already has:

```ts
const listener = runHttpTeamServer(EXAMPLE_TEAM, { port, authToken });

process.once('SIGTERM', () => listener.close());
```

Pass `handleSignals: true` to have it register that closer for `SIGINT` and
`SIGTERM` itself. It is off by default, and even when on it only closes the
listener — an embedding application has its own shutdown order, and a handler
installed here would run beside it rather than within it.

## The integration flow

What a host does with a server, and where your code runs:

1. **Connect and read the descriptor** — `intake_get_team_descriptor`. The host
   learns the department's identity, its fields and its readiness notes.
2. **Collect a request** — the host runs the conversation. Your fields and your
   readiness notes shape what it asks for.
3. **Check readiness** — `intake_validate_definition_of_ready` with the draft.
   Your `validate` answers `{ ready, blockers, warnings }`. Expect to be asked
   again whenever the draft changes, and at the moment a ticket is created.
4. **Render** — `intake_render_ticket` with the same draft. Your `render`
   returns the body, and optionally a summary in your own convention.
5. **Create** — the host creates the ticket, on the board your descriptor named.

Two expectations a host will hold you to, and the reason for each:

- **`validate` and `render` must be fast and make no network calls.** A host
  bounds every call it makes and treats an overrun as the server being
  unhealthy — so a render that reached out would take your department offline
  under load.
- **In a stdio server, stdout is the protocol.** Write diagnostics to stderr;
  one stray `console.log` desynchronises the connection. `runStdioTeamServer`
  already respects this.

Assume a host validates everything you return, field by field, and treats a
malformed descriptor as the department being *unavailable* rather than
partially understood.

## Who implements what

| | SDK | Department |
| --- | --- | --- |
| MCP server, `tools/list`, `tools/call` dispatch | ✅ | |
| stdio and streamable HTTP transports, and starting them | ✅ | |
| Closing the HTTP listener, and when the process ends | | ✅ |
| Bearer-token authentication on HTTP | ✅ | |
| Parsing an incoming draft, surviving a malformed one | ✅ | |
| Blocker/warning bookkeeping, enum and required-field checks | ✅ | |
| Markdown section/bullet/compose primitives | ✅ | |
| Reading `<PREFIX>_JIRA_*` into a mapping | ✅ | |
| Team identity, title, subtitle | | ✅ |
| The intake fields and their descriptions | | ✅ |
| The issue type, and the prefix its routing is read from | | ✅ |
| Definition of Ready rules and their wording | | ✅ |
| Readiness notes published to the host | | ✅ |
| The ticket template | | ✅ |
| Any extra read-only tools | | ✅ |
| Which environment variables exist, and their values | | ✅ |

## Configuration convention

A project key, a label and a field id belong to a Jira *instance*, not to a
department: the same department points at different keys in a sandbox and in
production. So `jiraMappingFromEnv` reads them from the environment under a
prefix the department chooses, and the descriptor keeps only what is genuinely
the department's own.

| Variable | Required | Shape |
| --- | --- | --- |
| `<PREFIX>_JIRA_PROJECT` | yes | Project key |
| `<PREFIX>_JIRA_LABELS` | yes | Comma-separated; the first is the routing label |
| `<PREFIX>_JIRA_ISSUE_TYPE_ID` | no | Numeric issue type id; blank inherits the host's default |
| `<PREFIX>_JIRA_ASSIGNEE_EMAIL` | no | Account email to assign tickets to; blank leaves them unassigned |

Call it at module load. A missing required variable then stops the server
starting, and the host reports the department as unavailable — the honest
outcome, since a server that started without knowing where its tickets go would
route them somewhere wrong and look healthy doing it.

The prefix is also the isolation mechanism: a server reads its own variables and
nothing else, so it cannot route onto a board it was not configured for.

## Working on the SDK

```
npm run build       # tsconfig.build.json -> dist/, src only
npm run typecheck
npm run lint
npm test            # tsconfig.json -> dist-test/, then node:test over it
```

Two configs on purpose: `tsconfig.build.json` compiles `src` alone into `dist/`,
which is what `files` publishes, while `tsconfig.json` compiles `src` and
`tests` into `dist-test/` for typechecking and the suite. Tests and fixtures
therefore cannot reach the package.

## License

MIT
