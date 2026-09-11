import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  CONTRACT_TOOL_NAMES,
  GET_TEAM_DESCRIPTOR_TOOL,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from '../contract/contract.constants';
import { toIntakeDraft } from '../draft/draft.helper';
import type {
  ITeamDefinition,
  ITeamTool,
  IToolInputSchema,
} from './team-definition';

/** Every contract tool that takes a draft advertises this same argument shape. */
const DRAFT_INPUT_SCHEMA: IToolInputSchema = {
  type: 'object',
  properties: {
    draft: {
      type: 'object',
      description:
        'The intake draft: `core` fields, `fieldValues` and `requester`.',
    },
  },
  required: ['draft'],
};

const EMPTY_INPUT_SCHEMA: IToolInputSchema = { type: 'object', properties: {} };

const SERVER_VERSION = '1.0.0';

/**
 * Wraps one team definition as an MCP server.
 *
 * The transport is the caller's choice — stdio for a server the host spawns,
 * streamable HTTP for one it reaches over the network — so this knows nothing
 * about how it is connected. Every team therefore publishes exactly the same
 * tool surface, which is what lets a host treat them interchangeably.
 *
 * The low-level `Server` rather than `McpServer`: this needs to publish its
 * tools' JSON Schema verbatim, because a host converts a model-facing schema
 * into its own schema type and a generated one would carry shapes that
 * conversion has to reject.
 *
 * @throws If a team tool takes a reserved contract name, or two take the same
 * name as each other.
 */
export function createTeamServer(definition: ITeamDefinition): Server {
  const server = new Server(
    {
      name: `intake-${definition.descriptor.team.key.toLowerCase()}`,
      version: SERVER_VERSION,
    },
    { capabilities: { tools: {} } },
  );

  const teamTools = definition.tools ?? [];

  assertToolNamesUsable(teamTools);

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: GET_TEAM_DESCRIPTOR_TOOL,
        title: 'Team descriptor',
        description:
          "This team's identity, Jira mapping, intake fields and readiness rules.",
        inputSchema: EMPTY_INPUT_SCHEMA,
        annotations: { readOnlyHint: true },
      },
      {
        name: VALIDATE_DEFINITION_OF_READY_TOOL,
        title: 'Definition of Ready',
        description: "Whether a draft meets this team's Definition of Ready.",
        inputSchema: DRAFT_INPUT_SCHEMA,
        annotations: { readOnlyHint: true },
      },
      {
        name: RENDER_TICKET_TOOL,
        title: 'Render ticket',
        description: "Renders the ticket body in this team's own template.",
        inputSchema: DRAFT_INPUT_SCHEMA,
        annotations: { readOnlyHint: true },
      },
      ...teamTools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly },
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case GET_TEAM_DESCRIPTOR_TOOL:
        return structured(definition.descriptor);

      case VALIDATE_DEFINITION_OF_READY_TOOL:
        return structured(definition.validate(toIntakeDraft(args)));

      case RENDER_TICKET_TOOL:
        return structured(definition.render(toIntakeDraft(args)));

      default: {
        const tool = teamTools.find((candidate) => candidate.name === name);

        if (!tool) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: tool.execute(args ?? {}) }],
        };
      }
    }
  });

  return server;
}

/**
 * Every team tool name checked before the server is handed back.
 *
 * Dispatch answers the contract names first, so a team tool taking one would be
 * published in `tools/list` and then never reached — and a host calling it would
 * get the contract's answer, not the team's. Two team tools sharing a name is
 * the same ambiguity one step further in, resolved silently by declaration
 * order. Neither is something a caller can see at runtime, so both stop startup
 * here rather than becoming a misrouted call later.
 */
function assertToolNamesUsable(tools: readonly ITeamTool[]): void {
  const seen = new Set<string>();

  for (const { name } of tools) {
    if (CONTRACT_TOOL_NAMES.includes(name)) {
      throw new Error(
        `Team tool "${name}" uses a name reserved by the intake contract. ` +
          `Reserved names: ${CONTRACT_TOOL_NAMES.join(', ')}.`,
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
function structured(payload: object): {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  };
}
