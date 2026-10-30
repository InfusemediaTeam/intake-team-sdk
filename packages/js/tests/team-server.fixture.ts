import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { IServiceCaller } from '../src/auth/service-token';
import { taskIdsDigest } from '../src/auth/service-token';
import type { IToolError } from '../src/contract/contract.types';
import { createTeamServer } from '../src/team/team-server';
import type { ITeamDefinition } from '../src/team/team-definition';
import { EXAMPLE_TEAM, READY_DRAFT } from './example-team.fixture';

/** A live client wired to a server over an in-memory pair — no process, no port. */
export const connect = async (
  definition: ITeamDefinition,
  caller: IServiceCaller | null = null,
): Promise<Client> => {
  const server = createTeamServer(definition, { caller });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });

  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  // As a host does: listing first caches each tool's output schema, so every
  // structured result below is also validated against `spec/`.
  await client.listTools();

  return client;
};

export const callerFor = (
  subject: string | null,
  scopes: readonly string[],
  taskIds?: readonly string[],
): IServiceCaller => ({
  issuer: 'host',
  subject,
  taskIdsDigest: taskIds ? taskIdsDigest(taskIds) : null,
  scopes,
  tokenId: 'jti',
  expiresAt: 0,
});

export const createArgs = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: 'request-1',
  draft: READY_DRAFT,
  requester: { userId: 'user-1', email: 'ada@example.test' },
  ...overrides,
});

export const errorOf = (result: Awaited<ReturnType<Client['callTool']>>) => {
  const [block] = result.content as { text: string }[];

  return (JSON.parse(block.text) as IToolError).error;
};

/** A team whose status lookup records what reached it and answers every id. */
export const statusRecorder = () => {
  const asked: (readonly string[])[] = [];
  const definition: ITeamDefinition = {
    descriptor: EXAMPLE_TEAM.descriptor,
    validate: (draft) => EXAMPLE_TEAM.validate(draft),
    render: (draft) => EXAMPLE_TEAM.render(draft),
    createTask: (input, context) => EXAMPLE_TEAM.createTask(input, context),
    getTaskStatus: (taskIds) => {
      asked.push(taskIds);

      return Promise.resolve({
        statuses: taskIds.map((taskId) => ({
          taskId,
          category: 'todo' as const,
          label: 'Open',
          assignee: null,
          lastChangedAt: null,
        })),
      });
    },
  };

  return { definition, asked };
};

/** The team without its own tools or status lookup, so the required surface stands alone. */
export const MINIMAL: ITeamDefinition = {
  descriptor: EXAMPLE_TEAM.descriptor,
  validate: (draft) => EXAMPLE_TEAM.validate(draft),
  render: (draft) => EXAMPLE_TEAM.render(draft),
  createTask: (input, context) => EXAMPLE_TEAM.createTask(input, context),
};
