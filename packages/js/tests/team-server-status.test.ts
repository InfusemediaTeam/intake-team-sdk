import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CREATE_TASK_TOOL,
  GET_TASK_STATUS_TOOL,
} from '../src/contract/contract.constants';
import { EXAMPLE_TEAM, exampleTeam } from './example-team.fixture';
import { MINIMAL, connect, createArgs, errorOf } from './team-server.fixture';

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
