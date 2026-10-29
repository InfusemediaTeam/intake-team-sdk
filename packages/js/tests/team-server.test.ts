import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { IServiceCaller } from '../src/auth/service-token';
import { taskIdsDigest } from '../src/auth/service-token';
import {
  CONTRACT_TOOL_NAMES,
  CREATE_SCOPE,
  CREATE_TASK_TOOL,
  GET_TASK_STATUS_TOOL,
  GET_TEAM_DESCRIPTOR_TOOL,
  READ_SCOPE,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from '../src/contract/contract.constants';
import type { IToolError } from '../src/contract/contract.types';
import { TaskError } from '../src/task/task-error';
import { createTeamServer } from '../src/team/team-server';
import type { ITeamDefinition, ITeamTool } from '../src/team/team-definition';
import {
  EXAMPLE_DRAFT,
  EXAMPLE_TEAM,
  EXAMPLE_TOOL,
  READY_DRAFT,
  exampleTeam,
} from './example-team.fixture';

/** A live client wired to a server over an in-memory pair — no process, no port. */
const connect = async (
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

const callerFor = (
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

const createArgs = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: 'request-1',
  draft: READY_DRAFT,
  requester: { userId: 'user-1', email: 'ada@example.test' },
  ...overrides,
});

const errorOf = (result: Awaited<ReturnType<Client['callTool']>>) => {
  const [block] = result.content as { text: string }[];

  return (JSON.parse(block.text) as IToolError).error;
};

/** A team whose status lookup records what reached it and answers every id. */
const statusRecorder = () => {
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
const MINIMAL: ITeamDefinition = {
  descriptor: EXAMPLE_TEAM.descriptor,
  validate: (draft) => EXAMPLE_TEAM.validate(draft),
  render: (draft) => EXAMPLE_TEAM.render(draft),
  createTask: (input, context) => EXAMPLE_TEAM.createTask(input, context),
};

describe('createTeamServer', () => {
  it('publishes the required contract tools, and status only when the team offers it', async () => {
    const minimal = await connect(MINIMAL);
    const full = await connect(EXAMPLE_TEAM);

    const names = async (client: Client) =>
      (await client.listTools()).tools.map((tool) => tool.name).sort();

    assert.deepEqual(
      await names(minimal),
      [
        CREATE_TASK_TOOL,
        GET_TEAM_DESCRIPTOR_TOOL,
        RENDER_TICKET_TOOL,
        VALIDATE_DEFINITION_OF_READY_TOOL,
      ].sort(),
    );
    assert.deepEqual(
      await names(full),
      [...CONTRACT_TOOL_NAMES, 'example_reference'].sort(),
    );

    await minimal.close();
    await full.close();
  });

  it('marks only creation as not read-only, so a host never hands it to a model', async () => {
    const client = await connect(EXAMPLE_TEAM);

    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.equal(
        tool.annotations?.readOnlyHint,
        tool.name !== CREATE_TASK_TOOL,
        tool.name,
      );
    }

    await client.close();
  });

  it('publishes an object input schema for every tool and an output schema for every contract tool', async () => {
    const client = await connect(EXAMPLE_TEAM);

    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object', tool.name);
      assert.equal(
        tool.outputSchema?.type === 'object',
        CONTRACT_TOOL_NAMES.includes(tool.name),
        tool.name,
      );
    }

    await client.close();
  });

  it('names the server after the team', async () => {
    const client = await connect(EXAMPLE_TEAM);

    assert.equal(client.getServerVersion()?.name, 'intake-example');

    await client.close();
  });

  describe('dispatch', () => {
    it('returns the descriptor as structured content, with the same JSON as text', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: GET_TEAM_DESCRIPTOR_TOOL,
        arguments: {},
      });
      const [block] = result.content as { type: string; text: string }[];

      assert.equal(
        (result.structuredContent as { team: { key: string } }).team.key,
        'EXAMPLE',
      );
      assert.deepEqual(JSON.parse(block.text), result.structuredContent);
      assert.equal('jira' in (result.structuredContent as object), false);

      await client.close();
    });

    it('routes a draft to the readiness check', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: VALIDATE_DEFINITION_OF_READY_TOOL,
        arguments: { draft: EXAMPLE_DRAFT },
      });
      const verdict = result.structuredContent as {
        ready: boolean;
        blockers: { field?: string }[];
      };

      assert.equal(verdict.ready, false);
      assert.ok(
        verdict.blockers.some((issue) => issue.field === 'exampleField'),
      );

      await client.close();
    });

    it('routes a draft to the renderer', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: RENDER_TICKET_TOOL,
        arguments: { draft: EXAMPLE_DRAFT },
      });

      assert.match(
        (result.structuredContent as { description: string }).description,
        /^## /,
      );

      await client.close();
    });

    it("routes to a team's own tool", async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: 'example_reference',
        arguments: {},
      });
      const [block] = result.content as { text: string }[];

      assert.match(block.text, /reference text/);

      await client.close();
    });

    it('reports an unknown tool as a contract error rather than an empty answer', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: 'no_such_tool',
        arguments: {},
      });

      assert.equal(result.isError, true);
      assert.equal(errorOf(result).code, 'INVALID_INPUT');

      await client.close();
    });

    it('does not throw on a malformed draft', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: VALIDATE_DEFINITION_OF_READY_TOOL,
        arguments: { draft: 'not an object' },
      });

      assert.equal(
        (result.structuredContent as { ready: boolean }).ready,
        false,
      );

      await client.close();
    });
  });

  describe('task creation', () => {
    it('creates a task and returns its reference', async () => {
      const team = exampleTeam();
      const client = await connect(team);

      const result = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });

      assert.deepEqual(result.structuredContent, {
        task: {
          id: 'task-1',
          displayKey: 'EX-1',
          url: 'https://tasks.example.test/EX-1',
          location: 'Example queue',
        },
      });
      assert.deepEqual(team.calls[0].requester, {
        userId: 'user-1',
        email: 'ada@example.test',
      });

      await client.close();
    });

    it('returns the same task for a retried idempotency key', async () => {
      const team = exampleTeam();
      const client = await connect(team);

      const first = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });
      const second = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });

      assert.deepEqual(second.structuredContent, first.structuredContent);
      assert.equal(team.created.size, 1);

      await client.close();
    });

    it('merges concurrent calls with the same key into one creation', async () => {
      const team = exampleTeam();
      const client = await connect(team);

      const results = await Promise.all(
        [1, 2, 3].map(() =>
          client.callTool({ name: CREATE_TASK_TOOL, arguments: createArgs() }),
        ),
      );

      assert.equal(team.calls.length, 1);
      for (const result of results) {
        assert.deepEqual(
          result.structuredContent,
          results[0].structuredContent,
        );
      }

      await client.close();
    });

    it('refuses a draft that fails the Definition of Ready without calling the team', async () => {
      const team = exampleTeam();
      const client = await connect(team);

      const result = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs({ draft: EXAMPLE_DRAFT }),
      });

      assert.equal(result.isError, true);
      assert.equal(errorOf(result).code, 'NOT_READY');
      assert.equal(team.calls.length, 0);

      await client.close();
    });

    for (const [label, overrides] of [
      ['no idempotency key', { idempotencyKey: undefined }],
      ['a malformed idempotency key', { idempotencyKey: 'has spaces' }],
      ['no requester', { requester: undefined }],
      ['a blank userId', { requester: { userId: '', email: null } }],
      ['a non-string email', { requester: { userId: 'user-1', email: 42 } }],
    ] as const) {
      it(`refuses ${label} as INVALID_INPUT`, async () => {
        const team = exampleTeam();
        const client = await connect(team);

        const result = await client.callTool({
          name: CREATE_TASK_TOOL,
          arguments: createArgs(overrides),
        });

        assert.equal(errorOf(result).code, 'INVALID_INPUT');
        assert.equal(team.calls.length, 0);

        await client.close();
      });
    }

    it('reports a TaskError with its own code, message and retryability', async () => {
      const client = await connect({
        ...MINIMAL,
        createTask: () =>
          Promise.reject(
            new TaskError('DESTINATION_UNAVAILABLE', 'Board is down', true),
          ),
      });

      const result = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });

      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
      assert.deepEqual(errorOf(result), {
        code: 'DESTINATION_UNAVAILABLE',
        message: 'Board is down',
        retryable: true,
      });

      await client.close();
    });

    it('hides an unexpected error behind a generic INTERNAL message', async () => {
      const client = await connect({
        ...MINIMAL,
        createTask: () => Promise.reject(new Error('password=hunter2')),
      });

      const result = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });

      assert.equal(errorOf(result).code, 'INTERNAL');
      assert.doesNotMatch(errorOf(result).message, /hunter2/);

      await client.close();
    });

    it('refuses a malformed task reference from the team', async () => {
      const client = await connect({
        ...MINIMAL,
        createTask: () =>
          Promise.resolve({
            task: {
              id: 'x',
              displayKey: 'X-1',
              url: 'javascript:alert(1)',
              location: null,
            },
          }),
      });

      const result = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });

      assert.equal(errorOf(result).code, 'INTERNAL');

      await client.close();
    });
  });

  describe('authorization with a token caller', () => {
    it('lets a create-scoped caller create a task for its own subject', async () => {
      const client = await connect(
        exampleTeam(),
        callerFor('user-1', [CREATE_SCOPE]),
      );

      const result = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });

      assert.equal(result.isError, undefined);

      await client.close();
    });

    it('refuses a requester userId that differs from the token subject', async () => {
      const team = exampleTeam();
      const client = await connect(team, callerFor('user-1', [CREATE_SCOPE]));

      const result = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs({
          requester: { userId: 'someone-else', email: null },
        }),
      });

      assert.equal(errorOf(result).code, 'FORBIDDEN');
      assert.equal(team.calls.length, 0);

      await client.close();
    });

    it('refuses creation to a token with no subject', async () => {
      const client = await connect(
        exampleTeam(),
        callerFor(null, [CREATE_SCOPE]),
      );

      const result = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });

      assert.equal(errorOf(result).code, 'FORBIDDEN');

      await client.close();
    });

    it('refuses creation to a read-only token', async () => {
      const team = exampleTeam();
      const client = await connect(team, callerFor('user-1', [READ_SCOPE]));

      const result = await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });

      assert.equal(errorOf(result).code, 'FORBIDDEN');
      assert.equal(team.calls.length, 0);

      await client.close();
    });

    describe('reading task status', () => {
      const read = async (caller: IServiceCaller, taskIds: string[]) => {
        const { definition, asked } = statusRecorder();
        const client = await connect(definition, caller);
        const result = await client.callTool({
          name: GET_TASK_STATUS_TOOL,
          arguments: { taskIds },
        });

        await client.close();

        return { result, asked };
      };

      it('answers exactly the tasks the token was issued for', async () => {
        const { result, asked } = await read(
          callerFor('user-1', [READ_SCOPE], ['T-1', 'T-2']),
          ['T-1', 'T-2'],
        );

        assert.equal(result.isError, undefined);
        assert.deepEqual(asked, [['T-1', 'T-2']]);
      });

      const refusals: readonly [string, IServiceCaller, string[]][] = [
        [
          'a token with no subject',
          callerFor(null, [READ_SCOPE], ['T-1']),
          ['T-1'],
        ],
        [
          'a token bound to no tasks',
          callerFor('user-1', [READ_SCOPE]),
          ['T-1'],
        ],
        [
          'an id the token was not issued for',
          callerFor('user-1', [READ_SCOPE], ['T-1']),
          ['T-1', 'SOMEONE-ELSES-9'],
        ],
        [
          'another set of ids than the token names',
          callerFor('user-1', [READ_SCOPE], ['T-1']),
          ['T-2'],
        ],
        [
          'a token without the read scope',
          callerFor('user-1', [CREATE_SCOPE], ['T-1']),
          ['T-1'],
        ],
      ];

      for (const [label, caller, taskIds] of refusals) {
        it(`refuses ${label}, before the team is asked`, async () => {
          const { result, asked } = await read(caller, taskIds);

          assert.equal(errorOf(result).code, 'FORBIDDEN');
          assert.deepEqual(asked, []);
        });
      }
    });

    it('refuses a read tool to a token without the read scope', async () => {
      const client = await connect(
        exampleTeam(),
        callerFor('user-1', [CREATE_SCOPE]),
      );

      const result = await client.callTool({
        name: GET_TEAM_DESCRIPTOR_TOOL,
        arguments: {},
      });

      assert.equal(errorOf(result).code, 'FORBIDDEN');

      await client.close();
    });
  });

  describe('task status', () => {
    it('reports the tasks it knows and leaves out the rest', async () => {
      const team = exampleTeam();
      const client = await connect(team);

      await client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs(),
      });

      const result = await client.callTool({
        name: GET_TASK_STATUS_TOOL,
        arguments: { taskIds: ['task-1', 'unknown'] },
      });

      assert.deepEqual(result.structuredContent, {
        statuses: [
          {
            taskId: 'task-1',
            category: 'todo',
            label: 'Open',
            assignee: null,
            lastChangedAt: null,
          },
        ],
      });

      await client.close();
    });

    it('drops a status for an id that was not asked about', async () => {
      const client = await connect({
        ...MINIMAL,
        getTaskStatus: () =>
          Promise.resolve({
            statuses: [
              {
                taskId: 'other',
                category: 'done',
                label: 'Done',
                assignee: null,
                lastChangedAt: null,
              },
            ],
          }),
      });

      const result = await client.callTool({
        name: GET_TASK_STATUS_TOOL,
        arguments: { taskIds: ['mine'] },
      });

      assert.deepEqual(result.structuredContent, { statuses: [] });

      await client.close();
    });

    it('refuses an empty id list', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: GET_TASK_STATUS_TOOL,
        arguments: { taskIds: [] },
      });

      assert.equal(errorOf(result).code, 'INVALID_INPUT');

      await client.close();
    });

    it('treats status as unknown for a team that does not offer it', async () => {
      const client = await connect(MINIMAL);

      const result = await client.callTool({
        name: GET_TASK_STATUS_TOOL,
        arguments: { taskIds: ['task-1'] },
      });

      assert.equal(errorOf(result).code, 'INVALID_INPUT');

      await client.close();
    });
  });

  describe('tool name validation', () => {
    const withTools = (tools: readonly ITeamTool[]): ITeamDefinition => ({
      ...EXAMPLE_TEAM,
      tools,
    });

    const named = (name: string): ITeamTool => ({ ...EXAMPLE_TOOL, name });

    for (const reserved of [...CONTRACT_TOOL_NAMES, 'intake_future_tool']) {
      it(`refuses a team tool named ${reserved}`, () => {
        assert.throws(() => createTeamServer(withTools([named(reserved)])), {
          message: /reserves/i,
        });
      });
    }

    it('refuses two team tools sharing a name', () => {
      assert.throws(
        () =>
          createTeamServer(withTools([named('duplicate'), named('duplicate')])),
        { message: /declared more than once/i },
      );
    });

    it('accepts distinct team names that are not reserved', () => {
      assert.doesNotThrow(() =>
        createTeamServer(withTools([named('one'), named('two')])),
      );
    });
  });
});
