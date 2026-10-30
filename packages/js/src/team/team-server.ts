import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { IServiceCaller } from '../auth/service-token';
import {
  CONTRACT_TOOL_PREFIX,
  CREATE_TASK_TOOL,
  GET_TASK_STATUS_TOOL,
  GET_TEAM_DESCRIPTOR_TOOL,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from '../contract/contract.constants';
import { assertContractOutput } from '../contract/contract-output';
import { toIntakeDraft } from '../draft/draft.helper';
import { SDK_VERSION, TOOL_CONTRACTS } from '../generated/contract.generated';
import { TaskError } from '../task/task-error';
import {
  checkedStatuses,
  toCreateTaskInput,
  toTaskIds,
} from '../task/task-input.helper';
import { createTask } from './task-creation';
import {
  authorize,
  authorizeStatusRead,
  requiredScope,
} from './team-authorization';
import type {
  ITaskCallContext,
  ITeamDefinition,
  ITeamTool,
} from './team-definition';
import type { ToolResult } from './tool-result';
import { failure, structured } from './tool-result';

export interface ITeamServerOptions {
  /**
   * The verified service-token caller, for a server reached over HTTP. `null`
   * for stdio, where only the spawning host can write to the process, so
   * every tool is allowed.
   */
  readonly caller: IServiceCaller | null;
}

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
 * @throws If the descriptor does not match its output schema, a team tool uses
 * the reserved `intake_` prefix, or two team tools share a name.
 */
export function createTeamServer(
  definition: ITeamDefinition,
  options: ITeamServerOptions = { caller: null },
): Server {
  // Every discovery call would fail on a descriptor the host's client rejects,
  // so it stops startup instead.
  assertContractOutput(GET_TEAM_DESCRIPTOR_TOOL, definition.descriptor);

  const server = new Server(
    { name: serverName(definition), version: SDK_VERSION },
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
      authorize(options.caller, requiredScope(name, teamTools));

      return await dispatch(definition, teamTools, name, args, context);
    } catch (error) {
      return failure(serverName(definition), name, error);
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
      return structured(GET_TEAM_DESCRIPTOR_TOOL, definition.descriptor);

    case VALIDATE_DEFINITION_OF_READY_TOOL:
      return structured(
        VALIDATE_DEFINITION_OF_READY_TOOL,
        definition.validate(toIntakeDraft(args)),
      );

    case RENDER_TICKET_TOOL:
      return structured(
        RENDER_TICKET_TOOL,
        definition.render(toIntakeDraft(args)),
      );

    case CREATE_TASK_TOOL:
      return structured(
        CREATE_TASK_TOOL,
        await createTask(definition, toCreateTaskInput(args), context),
      );

    case GET_TASK_STATUS_TOOL: {
      if (!definition.getTaskStatus) break;

      const taskIds = toTaskIds(args);

      authorizeStatusRead(context.caller, taskIds);

      return structured(
        GET_TASK_STATUS_TOOL,
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

function serverName(definition: ITeamDefinition): string {
  return `intake-${definition.descriptor.team.key.toLowerCase()}`;
}
