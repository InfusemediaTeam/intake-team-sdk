/**
 * intake-team-sdk — the toolkit for building an intake MCP server.
 *
 * Everything here is department-independent: the wire contract, the server and
 * its transports, and helpers for the parts every team writes the same way.
 * What a team asks for, when it considers a draft ready and how it renders a
 * ticket are the team's own and belong in the department's own package.
 */

export {
  CONTRACT_TOOL_NAMES,
  GET_TEAM_DESCRIPTOR_TOOL,
  INTAKE_CONTRACT_VERSION,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from './contract/contract.constants';

export type {
  IDefinitionOfReadyVerdict,
  IIntakeCoreFields,
  IIntakeDraft,
  IIntakeRequester,
  IReadinessIssue,
  IRenderedTicket,
  ITeamDescriptor,
  ITeamField,
  ITeamIdentity,
  ITeamJiraMapping,
  TeamFieldKind,
} from './contract/contract.types';

export type {
  ITeamDefinition,
  ITeamTool,
  IToolInputSchema,
} from './team/team-definition';
export { createTeamServer } from './team/team-server';

export {
  draftProse,
  fieldValue,
  filled,
  includesAny,
  toIntakeDraft,
} from './draft/draft.helper';

export type { IEnumFieldMessages } from './readiness/readiness.report';
export { ReadinessReport, readiness } from './readiness/readiness.report';

export { bullets, compose, labelled, section } from './render/render.helper';

export type { IJiraMappingOptions } from './jira/jira-env';
export {
  jiraMappingFromEnv,
  requiredEnv,
  requiredEnvList,
} from './jira/jira-env';

export { isBearerAuthorized } from './transport/bearer-auth';
export { runStdioTeamServer } from './transport/stdio';
export type { IHttpTeamServerOptions } from './transport/http';
export { runHttpTeamServer } from './transport/http';
