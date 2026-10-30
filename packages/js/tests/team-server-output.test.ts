import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import {
  CREATE_TASK_TOOL,
  GET_TASK_STATUS_TOOL,
  GET_TEAM_DESCRIPTOR_TOOL,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from '../src/contract/contract.constants';
import type {
  ITaskReference,
  ITaskStatus,
  ITeamDescriptor,
} from '../src/contract/contract.types';
import { createTeamServer } from '../src/team/team-server';
import type { ITeamDefinition } from '../src/team/team-definition';
import { EXAMPLE_TEAM, READY_DRAFT } from './example-team.fixture';
import { MINIMAL, connect, createArgs, errorOf } from './team-server.fixture';

/**
 * A team's output is held to the output schemas `tools/list` publishes before
 * it leaves, so what the host's client would reject arrives as the contract's
 * `INTERNAL` error instead. Every call below goes through a real client that
 * has listed the tools, as a host does, and would itself throw on a result
 * that fails its schema.
 */

type CallResult = Awaited<ReturnType<Client['callTool']>>;

const REFERENCE: ITaskReference = {
  id: 'task-1',
  displayKey: 'EX-1',
  url: 'https://tasks.example.test/EX-1',
  location: 'Example queue',
};

const STATUS: ITaskStatus = {
  taskId: 'task-1',
  category: 'todo',
  label: 'Open',
  assignee: null,
  lastChangedAt: null,
};

const assertInternal = (result: CallResult) => {
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.equal(errorOf(result).code, 'INTERNAL');
};

const withDescriptor = (
  overrides: Partial<ITeamDescriptor>,
): ITeamDefinition => ({
  ...MINIMAL,
  descriptor: { ...EXAMPLE_TEAM.descriptor, ...overrides },
});

const call = async (
  definition: ITeamDefinition,
  name: string,
  args: Record<string, unknown>,
): Promise<CallResult> => {
  const client = await connect(definition);

  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
};

const created = (task: ITaskReference) =>
  call(
    { ...MINIMAL, createTask: () => Promise.resolve({ task }) },
    CREATE_TASK_TOOL,
    createArgs(),
  );

const statuses = (entries: readonly ITaskStatus[]) =>
  call(
    {
      ...MINIMAL,
      getTaskStatus: () => Promise.resolve({ statuses: entries }),
    },
    GET_TASK_STATUS_TOOL,
    { taskIds: ['task-1'] },
  );

describe('output schema validation', () => {
  it('passes output at the schema limits through unchanged', async () => {
    const description = 'd'.repeat(30000);
    const rendered = await call(
      { ...MINIMAL, render: () => ({ description, summary: 's'.repeat(500) }) },
      RENDER_TICKET_TOOL,
      { draft: READY_DRAFT },
    );
    const task = { ...REFERENCE, displayKey: 'K'.repeat(64) };
    const creation = await created(task);
    const status = { ...STATUS, label: 'L'.repeat(100) };
    const read = await statuses([status]);

    assert.equal(rendered.isError, undefined);
    assert.deepEqual(rendered.structuredContent, {
      description,
      summary: 's'.repeat(500),
    });
    assert.deepEqual(creation.structuredContent, { task });
    assert.deepEqual(read.structuredContent, { statuses: [status] });
  });

  describe('render results', () => {
    for (const [label, rendered] of [
      ['an overlong description', { description: 'd'.repeat(30001) }],
      ['an empty description', { description: '' }],
      ['an overlong summary', { description: 'ok', summary: 's'.repeat(501) }],
      ['no description', {}],
    ] as const) {
      it(`reports ${label} as INTERNAL`, async () => {
        const definition = {
          ...MINIMAL,
          render: () => rendered,
        } as unknown as ITeamDefinition;

        assertInternal(
          await call(definition, RENDER_TICKET_TOOL, { draft: READY_DRAFT }),
        );
      });
    }
  });

  describe('readiness verdicts', () => {
    const issue = { field: 'title', message: 'Needs a title.' };

    for (const [label, verdict] of [
      [
        'more blockers than the schema allows',
        { ready: false, blockers: Array(26).fill(issue), warnings: [] },
      ],
      [
        'an overlong warning',
        {
          ready: true,
          blockers: [],
          warnings: [{ message: 'w'.repeat(501) }],
        },
      ],
    ] as const) {
      it(`reports ${label} as INTERNAL`, async () => {
        assertInternal(
          await call(
            { ...MINIMAL, validate: () => verdict },
            VALIDATE_DEFINITION_OF_READY_TOOL,
            { draft: READY_DRAFT },
          ),
        );
      });
    }
  });

  describe('task references', () => {
    for (const [label, task] of [
      ['an overlong id', { ...REFERENCE, id: 'i'.repeat(257) }],
      ['an overlong displayKey', { ...REFERENCE, displayKey: 'K'.repeat(65) }],
      [
        'an overlong url',
        { ...REFERENCE, url: `https://x.test/${'p'.repeat(2048)}` },
      ],
      ['an overlong location', { ...REFERENCE, location: 'l'.repeat(501) }],
      ['a url that is not http(s)', { ...REFERENCE, url: 'ftp://x.test' }],
    ] as const) {
      it(`reports ${label} as INTERNAL`, async () => {
        assertInternal(await created(task));
      });
    }
  });

  describe('task statuses', () => {
    for (const [label, status] of [
      ['an overlong label', { ...STATUS, label: 'L'.repeat(101) }],
      ['an overlong assignee', { ...STATUS, assignee: 'a'.repeat(201) }],
      [
        'an overlong lastChangedAt',
        { ...STATUS, lastChangedAt: 't'.repeat(65) },
      ],
    ] as const) {
      it(`drops a status with ${label}, as any malformed status is`, async () => {
        const result = await statuses([status, STATUS]);

        assert.deepEqual(result.structuredContent, { statuses: [STATUS] });
      });
    }

    it('reports more statuses than the schema allows as INTERNAL', async () => {
      assertInternal(await statuses(Array<ITaskStatus>(51).fill(STATUS)));
    });
  });

  describe('descriptors', () => {
    for (const [label, overrides] of [
      [
        'more fields than the schema allows',
        { fields: Array(26).fill(EXAMPLE_TEAM.descriptor.fields[0]) },
      ],
      ['an overlong readiness note', { readinessNotes: ['n'.repeat(501)] }],
      [
        'a team key the schema rejects',
        { team: { ...EXAMPLE_TEAM.descriptor.team, key: 'lower-case' } },
      ],
      ['another contract major version', { contractVersion: '1.0' }],
    ] as const) {
      it(`refuses to build a server for ${label}`, () => {
        assert.throws(
          () => createTeamServer(withDescriptor(overrides)),
          /intake_get_team_descriptor result does not match its output schema/,
        );
      });
    }

    it('reports a descriptor changed after startup as INTERNAL', async () => {
      const fields = [...EXAMPLE_TEAM.descriptor.fields];
      const client = await connect(withDescriptor({ fields }));

      fields.push(...Array<(typeof fields)[number]>(25).fill(fields[0]));

      assertInternal(
        await client.callTool({
          name: GET_TEAM_DESCRIPTOR_TOOL,
          arguments: {},
        }),
      );

      await client.close();
    });
  });
});
