import { INTAKE_CONTRACT_VERSION } from '../src/contract/contract.constants';
import type {
  ICreateTaskInput,
  IIntakeDraft,
  ITaskReference,
} from '../src/contract/contract.types';
import { readiness } from '../src/readiness/readiness.report';
import { compose, section } from '../src/render/render.helper';
import type { ITeamDefinition, ITeamTool } from '../src/team/team-definition';

/**
 * A deliberately uninteresting team, so the suites exercise the SDK rather
 * than anybody's rules. Its tasks live in memory, keyed the way a real team
 * keys its own storage: by idempotency key.
 */
export const EXAMPLE_TOOL: ITeamTool = {
  name: 'example_reference',
  title: 'Example reference',
  description: 'Returns a fixed string.',
  inputSchema: { type: 'object', properties: {} },
  readOnly: true,
  execute: () => 'reference text',
};

export interface IExampleTeam extends ITeamDefinition {
  readonly created: Map<string, ITaskReference>;
  readonly calls: ICreateTaskInput[];
}

export function exampleTeam(): IExampleTeam {
  const created = new Map<string, ITaskReference>();
  const calls: ICreateTaskInput[] = [];

  return {
    created,
    calls,
    descriptor: {
      contractVersion: INTAKE_CONTRACT_VERSION,
      team: { key: 'EXAMPLE', title: 'Example team', subtitle: 'For tests' },
      fields: [
        {
          key: 'exampleField',
          label: 'Example field',
          description: 'Something the team asks for.',
          kind: 'text',
          required: true,
        },
      ],
      readinessNotes: ['The example field is required.'],
    },
    validate: (draft: IIntakeDraft) =>
      readiness(draft)
        .requireCore('title', 'The ticket needs a short title.')
        .requireField('exampleField', 'Fill in the example field.')
        .verdict(),
    render: (draft: IIntakeDraft) => ({
      description: compose([section('Summary', draft.core.whatNeeded)]),
    }),
    createTask: async (input) => {
      calls.push(input);
      // A turn of the event loop, so concurrent calls genuinely overlap.
      await new Promise((resolve) => setImmediate(resolve));

      const existing = created.get(input.idempotencyKey);

      if (existing) return { task: existing };

      const task: ITaskReference = {
        id: `task-${created.size + 1}`,
        displayKey: `EX-${created.size + 1}`,
        url: `https://tasks.example.test/EX-${created.size + 1}`,
        location: 'Example queue',
      };

      created.set(input.idempotencyKey, task);

      return { task };
    },
    getTaskStatus: (taskIds) =>
      Promise.resolve({
        statuses: [...created.values()]
          .filter((task) => taskIds.includes(task.id))
          .map((task) => ({
            taskId: task.id,
            category: 'todo' as const,
            label: 'Open',
            assignee: null,
            lastChangedAt: null,
          })),
      }),
    tools: [EXAMPLE_TOOL],
  };
}

export const EXAMPLE_TEAM: ITeamDefinition = exampleTeam();

export const EXAMPLE_DRAFT: IIntakeDraft = {
  core: {
    title: 'A title',
    whatNeeded: 'Some work',
    urgency: null,
    businessValue: null,
    approver: null,
  },
  fieldValues: {},
  requester: { displayName: 'Ada Lovelace', department: 'Research' },
};

export const READY_DRAFT: IIntakeDraft = {
  ...EXAMPLE_DRAFT,
  fieldValues: { exampleField: 'filled' },
};
