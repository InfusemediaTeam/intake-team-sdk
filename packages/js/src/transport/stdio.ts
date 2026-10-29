import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createTeamServer } from '../team/team-server';
import type { ITeamDefinition } from '../team/team-definition';

const STARTUP_FAILURE_EXIT_CODE = 1;

/**
 * Serves one team over stdio, for a host that spawns the server as a child
 * process.
 *
 * Nothing is written to stdout — that channel carries the JSON-RPC framing, and
 * a stray line there desynchronises the protocol. Diagnostics go to stderr,
 * which a spawning host captures.
 *
 * A failure to start exits non-zero rather than rejecting: there is nobody left
 * to handle the rejection, and a server that stays up without a transport looks
 * healthy while answering nothing.
 */
export async function runStdioTeamServer(
  definition: ITeamDefinition,
): Promise<void> {
  const name = serverName(definition);

  try {
    const server = createTeamServer(definition);

    await server.connect(new StdioServerTransport());

    process.stderr.write(`${name} MCP server ready on stdio\n`);
  } catch (error) {
    process.stderr.write(`${name} failed to start: ${String(error)}\n`);
    process.exit(STARTUP_FAILURE_EXIT_CODE);
  }
}

function serverName(definition: ITeamDefinition): string {
  return `intake-${definition.descriptor.team.key.toLowerCase()}`;
}
