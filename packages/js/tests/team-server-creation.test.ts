import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CREATE_TASK_TOOL } from '../src/contract/contract.constants';
import { TaskError } from '../src/task/task-error';
import type { ITeamDefinition } from '../src/team/team-definition';
import { EXAMPLE_DRAFT, exampleTeam } from './example-team.fixture';
import { MINIMAL, connect, createArgs, errorOf } from './team-server.fixture';

/**
 * The example team, except that its first creation stalls until its call is
 * aborted, then gives up or, without `honoursAbort`, finishes anyway. Every
 * later creation finishes at once.
 *
 * `started` resolves once the first creation is in flight; `joined` once
 * `waiters` further calls have passed readiness, the last step before each
 * joins the creation in flight, all within the same turn.
 */
const stallingTeam = (waiters: number, honoursAbort = true) => {
  const team = exampleTeam();
  let validated = 0;
  let attempts = 0;
  let markStarted!: () => void;
  let markJoined!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const joined = new Promise<void>((resolve) => {
    markJoined = resolve;
  });

  const definition: ITeamDefinition = {
    ...team,
    validate: (draft) => {
      validated += 1;

      if (validated === waiters + 1) markJoined();

      return team.validate(draft);
    },
    createTask: async (input, context) => {
      attempts += 1;

      if (attempts === 1) {
        markStarted();

        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });

        if (honoursAbort) {
          throw new TaskError('DESTINATION_UNAVAILABLE', 'Gave up', true);
        }
      }

      return team.createTask(input, context);
    },
  };

  return { definition, team, started, joined, attempts: () => attempts };
};

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
      assert.deepEqual(result.structuredContent, results[0].structuredContent);
    }

    await client.close();
  });

  it('merges different requesters that use the same key, as the key alone names a creation', async () => {
    const team = exampleTeam();
    const client = await connect(team);

    const [first, second] = await Promise.all([
      client.callTool({ name: CREATE_TASK_TOOL, arguments: createArgs() }),
      client.callTool({
        name: CREATE_TASK_TOOL,
        arguments: createArgs({ requester: { userId: 'user-2', email: null } }),
      }),
    ]);

    assert.equal(team.calls.length, 1);
    assert.deepEqual(second.structuredContent, first.structuredContent);

    await client.close();
  });

  it('creates independently for different keys', async () => {
    const team = exampleTeam();
    const client = await connect(team);

    const results = await Promise.all(
      ['key-1', 'key-2', 'key-3'].map((idempotencyKey) =>
        client.callTool({
          name: CREATE_TASK_TOOL,
          arguments: createArgs({ idempotencyKey }),
        }),
      ),
    );

    assert.equal(team.calls.length, 3);
    assert.equal(team.created.size, 3);
    assert.equal(
      new Set(results.map((result) => JSON.stringify(result.structuredContent)))
        .size,
      3,
    );

    await client.close();
  });

  it('shares a failure with every merged call rather than retrying it', async () => {
    let calls = 0;
    const client = await connect({
      ...MINIMAL,
      createTask: async () => {
        calls += 1;
        await new Promise((resolve) => setImmediate(resolve));

        throw new TaskError('DESTINATION_UNAVAILABLE', 'Board is down', true);
      },
    });

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        client.callTool({ name: CREATE_TASK_TOOL, arguments: createArgs() }),
      ),
    );

    assert.equal(calls, 1);
    for (const result of results) {
      assert.equal(errorOf(result).code, 'DESTINATION_UNAVAILABLE');
    }

    await client.close();
  });

  describe('when the call that owns a creation is aborted', () => {
    const abandon = async (waiters: number, honoursAbort = true) => {
      const stalling = stallingTeam(waiters, honoursAbort);
      const client = await connect(stalling.definition);
      const owner = new AbortController();

      const owned = client.callTool(
        { name: CREATE_TASK_TOOL, arguments: createArgs() },
        undefined,
        { signal: owner.signal },
      );

      await stalling.started;

      const waiting = Array.from({ length: waiters }, () =>
        client.callTool({ name: CREATE_TASK_TOOL, arguments: createArgs() }),
      );

      await stalling.joined;
      owner.abort();

      await assert.rejects(owned);

      const results = await Promise.all(waiting);

      await client.close();

      return { ...stalling, results };
    };

    it('lets a waiting retry take the creation over', async () => {
      const { results, attempts, team } = await abandon(1);

      assert.equal(results[0].isError, undefined);
      assert.deepEqual(results[0].structuredContent, {
        task: {
          id: 'task-1',
          displayKey: 'EX-1',
          url: 'https://tasks.example.test/EX-1',
          location: 'Example queue',
        },
      });
      assert.equal(attempts(), 2);
      assert.equal(team.created.size, 1);
    });

    it('takes over once for every waiting call, so no task is created twice', async () => {
      const { results, attempts, team } = await abandon(3);

      assert.equal(attempts(), 2);
      assert.equal(team.created.size, 1);
      for (const result of results) {
        assert.equal(result.isError, undefined);
        assert.deepEqual(
          result.structuredContent,
          results[0].structuredContent,
        );
      }
    });

    it('shares the task when the team finishes despite the abort', async () => {
      const { results, attempts, team } = await abandon(2, false);

      assert.equal(attempts(), 1);
      assert.equal(team.created.size, 1);
      for (const result of results) {
        assert.equal(result.isError, undefined);
      }
    });
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
