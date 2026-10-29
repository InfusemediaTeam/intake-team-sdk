import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { IServiceCaller } from '../auth/service-token';
import { taskIdsDigest } from '../auth/service-token';
import {
  CONTRACT_TOOL_PREFIX,
  CREATE_SCOPE,
  CREATE_TASK_TOOL,
  GET_TASK_STATUS_TOOL,
  GET_TEAM_DESCRIPTOR_TOOL,
  READ_SCOPE,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from '../contract/contract.constants';
import type {
  ICreateTaskInput,
  ICreateTaskResult,
} from '../contract/contract.types';
import { toIntakeDraft } from '../draft/draft.helper';
import { TOOL_CONTRACTS } from '../generated/contract.generated';
import { TaskError } from '../task/task-error';
import {
  checkedStatuses,
  checkedTaskReference,
  toCreateTaskInput,
  toTaskIds,
} from '../task/task-input.helper';
import type {
  ITaskCallContext,
  ITeamDefinition,
  ITeamTool,
} from './team-definition';

const SERVER_VERSION = '2.0.0';

const INTERNAL_MESSAGE = 'The department could not complete the request.';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export interface ITeamServerOptions {
  /**
   * The verified service-token caller, for a server reached over HTTP. `null`
   * for stdio, where only the spawning host can write to the process, so
   * every tool is allowed.
   */
  readonly caller: IServiceCaller | null;
}

/**
 * Creations in flight per team and key, shared by every server built for the
 * same definition: the HTTP transport builds a fresh server per request, and
 * two concurrent retries must still meet here.
 */
const inFlight = new WeakMap<
  ITeamDefinition,
  Map<string, Promise<ICreateTaskResult>>
>();

/**
 * Wraps one team definition as an MCP server.
 *
 * The transport is the caller's choice — stdio for a server the host spawns,
 * streamable HTTP for one it reaches over the network — so this knows nothing
 * about how it is connected. Every team publishes the same contract tools,
 * with the input and output schemas from `spec/`, which is what lets a host
 * treat them interchangeably.
 *
 * The low-level `Server` rather than `McpServer`: tools' JSON Schema is
 * published verbatim, because a host converts a model-facing schema into its
 * own schema type and a generated one would carry shapes it has to reject.
 *
 * @throws If a team tool uses the reserved `intake_` prefix, or two team tools
 * share a name.
 */
export function createTeamServer(
  definition: ITeamDefinition,
  options: ITeamServerOptions = { caller: null },
): Server {
  const server = new Server(
    { name: serverName(definition), version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  const teamTools = definition.tools ?? [];

  assertToolNamesUsable(teamTools);

  const contractTools = TOOL_CONTRACTS.filter(
    (tool) =>
      tool.name !== GET_TASK_STATUS_TOOL ||
      definition.getTaskStatus !== undefined,
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...contractTools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as { type: 'object' },
        outputSchema: tool.outputSchema as { type: 'object' },
        annotations: {
          readOnlyHint: tool.readOnly,
          ...(tool.readOnly
            ? {}
            : { destructiveHint: false, idempotentHint: true }),
        },
      })),
      ...teamTools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly },
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const context: ITaskCallContext = {
      caller: options.caller,
      signal: extra.signal,
    };

    try {
      authorize(
        options.caller,
        name === CREATE_TASK_TOOL ? CREATE_SCOPE : READ_SCOPE,
      );

      return await dispatch(definition, teamTools, name, args, context);
    } catch (error) {
      return failure(definition, name, error);
    }
  });

  return server;
}

async function dispatch(
  definition: ITeamDefinition,
  teamTools: readonly ITeamTool[],
  name: string,
  args: Record<string, unknown> | undefined,
  context: ITaskCallContext,
): Promise<ToolResult> {
  switch (name) {
    case GET_TEAM_DESCRIPTOR_TOOL:
      return structured(definition.descriptor);

    case VALIDATE_DEFINITION_OF_READY_TOOL:
      return structured(definition.validate(toIntakeDraft(args)));

    case RENDER_TICKET_TOOL:
      return structured(definition.render(toIntakeDraft(args)));

    case CREATE_TASK_TOOL:
      return structured(
        await createTask(definition, toCreateTaskInput(args), context),
      );

    case GET_TASK_STATUS_TOOL: {
      if (!definition.getTaskStatus) break;

      const taskIds = toTaskIds(args);

      authorizeStatusRead(context.caller, taskIds);

      return structured(
        checkedStatuses(
          await definition.getTaskStatus(taskIds, context),
          taskIds,
        ),
      );
    }

    default: {
      const tool = teamTools.find((candidate) => candidate.name === name);

      if (!tool) break;

      return {
        content: [{ type: 'text', text: await tool.execute(args ?? {}) }],
      };
    }
  }

  throw new TaskError('INVALID_INPUT', `Unknown tool: ${name}`);
}

/**
 * The generic gates in front of a team's own `createTask`.
 *
 * The requester must be the token's subject, so a host cannot be tricked into
 * filing a task under someone else by whatever wrote the arguments. The draft
 * must pass the team's own readiness check again: confirmation at the host is
 * a claim about the draft, and this is where it is checked.
 */
async function createTask(
  definition: ITeamDefinition,
  input: ICreateTaskInput,
  context: ITaskCallContext,
): Promise<ICreateTaskResult> {
  if (context.caller && context.caller.subject !== input.requester.userId) {
    throw new TaskError(
      'FORBIDDEN',
      'The requester does not match the authenticated caller',
    );
  }

  const verdict = definition.validate(input.draft);

  if (!verdict.ready) {
    throw new TaskError(
      'NOT_READY',
      'The draft does not meet the Definition of Ready',
    );
  }

  const pending = inFlightFor(definition);
  const key = `${input.requester.userId}\u0000${input.idempotencyKey}`;
  const running = pending.get(key);

  if (running) return running;

  const created = (async () => {
    const result = await definition.createTask(input, context);

    return { task: checkedTaskReference(result.task) };
  })();

  pending.set(key, created);

  try {
    return await created;
  } finally {
    pending.delete(key);
  }
}

function inFlightFor(
  definition: ITeamDefinition,
): Map<string, Promise<ICreateTaskResult>> {
  let pending = inFlight.get(definition);

  if (!pending) {
    pending = new Map();
    inFlight.set(definition, pending);
  }

  return pending;
}

/** @throws TaskError when a token caller lacks the scope. */
function authorize(caller: IServiceCaller | null, scope: string): void {
  if (caller && !caller.scopes.includes(scope)) {
    throw new TaskError('FORBIDDEN', `This call needs the ${scope} scope`);
  }
}

/**
 * A token caller reads only the tasks its token was issued for.
 *
 * The host is the one that knows whose task is whose: it signs the requester
 * as `sub` and the ids it found owned by them as `task_ids_sha256`. Requiring
 * both, and an exact match on the ids, means a token can never read a task id
 * added to the call after signing, and one issued without a requester — for
 * discovery or a preview — reads none at all.
 *
 * @throws TaskError `FORBIDDEN` otherwise; the reason is not told apart, so a
 * refusal says nothing about whose tasks these are.
 */
function authorizeStatusRead(
  caller: IServiceCaller | null,
  taskIds: readonly string[],
): void {
  if (!caller) return;

  if (
    caller.subject === null ||
    caller.taskIdsDigest === null ||
    caller.taskIdsDigest !== taskIdsDigest(taskIds)
  ) {
    throw new TaskError('FORBIDDEN', 'This token does not cover these tasks');
  }
}

/**
 * Every team tool name checked before the server is handed back.
 *
 * The whole `intake_` prefix is reserved, not just today's names, so a contract
 * tool added later can never be shadowed by a team tool that took its name
 * first. Two team tools sharing a name would be resolved silently by
 * declaration order. Both stop startup rather than misroute a call later.
 */
function assertToolNamesUsable(tools: readonly ITeamTool[]): void {
  const seen = new Set<string>();

  for (const { name } of tools) {
    if (name.startsWith(CONTRACT_TOOL_PREFIX)) {
      throw new Error(
        `Team tool "${name}" uses the "${CONTRACT_TOOL_PREFIX}" prefix, which the intake contract reserves.`,
      );
    }

    if (seen.has(name)) {
      throw new Error(`Team tool "${name}" is declared more than once.`);
    }

    seen.add(name);
  }
}

/**
 * A contract result, sent both ways.
 *
 * `structuredContent` is what a host reads; the JSON text alongside it keeps
 * the result legible to any MCP client that only understands content blocks.
 */
function structured(payload: object): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

/**
 * The contract's error result: the JSON of `ToolError` as text, and no
 * `structuredContent`, which a client would validate against the success
 * schema. An unexpected error is logged here and reported generically, so
 * nothing internal reaches the requester.
 */
function failure(
  definition: ITeamDefinition,
  tool: string,
  error: unknown,
): ToolResult {
  const body =
    error instanceof TaskError
      ? error.toBody()
      : {
          code: 'INTERNAL' as const,
          message: INTERNAL_MESSAGE,
          retryable: true,
        };

  if (!(error instanceof TaskError)) {
    process.stderr.write(
      `${serverName(definition)} ${tool} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: body }) }],
  };
}

function serverName(definition: ITeamDefinition): string {
  return `intake-${definition.descriptor.team.key.toLowerCase()}`;
}
