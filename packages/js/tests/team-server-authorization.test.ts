import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IServiceCaller } from '../src/auth/service-token';
import {
  CREATE_SCOPE,
  CREATE_TASK_TOOL,
  GET_TASK_STATUS_TOOL,
  GET_TEAM_DESCRIPTOR_TOOL,
  READ_SCOPE,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from '../src/contract/contract.constants';
import { TOOL_CONTRACTS } from '../src/generated/contract.generated';
import type { ITeamDefinition, ITeamTool } from '../src/team/team-definition';
import { EXAMPLE_TOOL, READY_DRAFT, exampleTeam } from './example-team.fixture';
import {
  callerFor,
  connect,
  createArgs,
  errorOf,
  statusRecorder,
} from './team-server.fixture';

/** The example team plus a team tool that changes state, recording each run. */
const withWriteTool = () => {
  const executed: string[] = [];
  const writeTool: ITeamTool = {
    ...EXAMPLE_TOOL,
    name: 'example_write',
    readOnly: false,
    execute: () => {
      executed.push('example_write');

      return 'written';
    },
  };
  const definition: ITeamDefinition = {
    ...exampleTeam(),
    tools: [EXAMPLE_TOOL, writeTool],
  };

  return { definition, executed };
};

/** Arguments a call to each tool can be answered with. */
const ARGUMENTS: Readonly<Record<string, Record<string, unknown>>> = {
  [GET_TEAM_DESCRIPTOR_TOOL]: {},
  [VALIDATE_DEFINITION_OF_READY_TOOL]: { draft: READY_DRAFT },
  [RENDER_TICKET_TOOL]: { draft: READY_DRAFT },
  [CREATE_TASK_TOOL]: createArgs(),
  [GET_TASK_STATUS_TOOL]: { taskIds: ['T-1'] },
};

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

  it("takes each contract tool's scope from spec/", async () => {
    for (const contract of TOOL_CONTRACTS) {
      const others = [READ_SCOPE, CREATE_SCOPE].filter(
        (scope) => scope !== contract.scope,
      );
      const client = await connect(exampleTeam(), callerFor('user-1', others));

      const result = await client.callTool({
        name: contract.name,
        arguments: ARGUMENTS[contract.name],
      });

      assert.equal(
        errorOf(result).message,
        `This call needs the ${contract.scope} scope`,
        contract.name,
      );

      await client.close();
    }
  });

  describe('team tools', () => {
    it('lets a read-only token run a read-only team tool', async () => {
      const { definition } = withWriteTool();
      const client = await connect(
        definition,
        callerFor('user-1', [READ_SCOPE]),
      );

      const result = await client.callTool({
        name: EXAMPLE_TOOL.name,
        arguments: {},
      });

      assert.equal(result.isError, undefined);

      await client.close();
    });

    it('refuses a team tool that changes state to a read-only token, before it runs', async () => {
      const { definition, executed } = withWriteTool();
      const client = await connect(
        definition,
        callerFor('user-1', [READ_SCOPE]),
      );

      const result = await client.callTool({
        name: 'example_write',
        arguments: {},
      });

      assert.equal(errorOf(result).code, 'FORBIDDEN');
      assert.equal(
        errorOf(result).message,
        `This call needs the ${CREATE_SCOPE} scope`,
      );
      assert.deepEqual(executed, []);

      await client.close();
    });

    it('lets a create-scoped token run a team tool that changes state', async () => {
      const { definition, executed } = withWriteTool();
      const client = await connect(
        definition,
        callerFor('user-1', [CREATE_SCOPE]),
      );

      const result = await client.callTool({
        name: 'example_write',
        arguments: {},
      });

      assert.equal(result.isError, undefined);
      assert.deepEqual(executed, ['example_write']);

      await client.close();
    });

    it('runs every team tool over stdio, where there is no token', async () => {
      const { definition, executed } = withWriteTool();
      const client = await connect(definition);

      const result = await client.callTool({
        name: 'example_write',
        arguments: {},
      });

      assert.equal(result.isError, undefined);
      assert.deepEqual(executed, ['example_write']);

      await client.close();
    });
  });

  describe('unknown or malformed scopes', () => {
    for (const scopes of [
      [],
      ['intake:admin'],
      ['INTAKE:READ', 'Intake:Create'],
      ['intake:read:all', 'intake:'],
      [`${READ_SCOPE} ${CREATE_SCOPE}`],
    ]) {
      it(`grant nothing: ${JSON.stringify(scopes)}`, async () => {
        const { definition, executed } = withWriteTool();
        const client = await connect(definition, callerFor('user-1', scopes));

        for (const name of [
          GET_TEAM_DESCRIPTOR_TOOL,
          CREATE_TASK_TOOL,
          EXAMPLE_TOOL.name,
          'example_write',
          'no_such_tool',
        ]) {
          const result = await client.callTool({
            name,
            arguments: ARGUMENTS[name] ?? {},
          });

          assert.equal(errorOf(result).code, 'FORBIDDEN', name);
        }

        assert.deepEqual(executed, []);

        await client.close();
      });
    }

    it('are ignored beside a scope the call needs', async () => {
      const client = await connect(
        exampleTeam(),
        callerFor('user-1', ['intake:admin', READ_SCOPE]),
      );

      const result = await client.callTool({
        name: GET_TEAM_DESCRIPTOR_TOOL,
        arguments: {},
      });

      assert.equal(result.isError, undefined);

      await client.close();
    });
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
      ['a token bound to no tasks', callerFor('user-1', [READ_SCOPE]), ['T-1']],
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
});
