import { INTAKE_CONTRACT_VERSION } from '../src/contract/contract.constants';
import type { IIntakeDraft } from '../src/contract/contract.types';
import { readiness } from '../src/readiness/readiness.report';
import { compose, section } from '../src/render/render.helper';
import type { ITeamDefinition, ITeamTool } from '../src/team/team-definition';

/**
 * A deliberately uninteresting team, so the suites exercise the SDK rather
 * than anybody's rules.
 */
export const EXAMPLE_TOOL: ITeamTool = {
  name: 'example_reference',
  title: 'Example reference',
  description: 'Returns a fixed string.',
  inputSchema: { type: 'object', properties: {} },
  readOnly: true,
  execute: () => 'reference text',
};

export const EXAMPLE_TEAM: ITeamDefinition = {
  descriptor: {
    contractVersion: INTAKE_CONTRACT_VERSION,
    team: { key: 'EXAMPLE', title: 'Example team', subtitle: 'For tests' },
    jira: { boardKey: 'EX', issueType: 'Task', labels: ['example'] },
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
  tools: [EXAMPLE_TOOL],
};

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
