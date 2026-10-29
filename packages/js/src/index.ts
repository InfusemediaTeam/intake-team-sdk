/**
 * intake-team-sdk — the toolkit for building an intake MCP server.
 *
 * Everything here is department-independent: the wire contract generated from
 * `spec/`, the server and its transports, service-token authentication, and
 * helpers for the parts every team writes the same way. What a team asks for,
 * when it considers a draft ready, how it renders a ticket and where it creates
 * the task are the team's own and belong in the department's own package.
 */

export {
  CONTRACT_TOOL_NAMES,
  CONTRACT_TOOL_PREFIX,
  CREATE_SCOPE,
  CREATE_TASK_TOOL,
  GET_TASK_STATUS_TOOL,
  GET_TEAM_DESCRIPTOR_TOOL,
  INTAKE_CONTRACT_VERSION,
  READ_SCOPE,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from './contract/contract.constants';

export type {
  ICreateTaskInput,
  ICreateTaskResult,
  IDefinitionOfReadyVerdict,
  IIntakeCoreFields,
  IIntakeDraft,
  IIntakeRequester,
  IReadinessIssue,
  IReadinessVerdict,
  IRenderedTicket,
  IServiceTokenClaims,
  ITaskReference,
  ITaskRequester,
  ITaskStatus,
  ITaskStatusInput,
  ITaskStatusResult,
  ITeamDescriptor,
  ITeamField,
  ITeamIdentity,
  IToolError,
  IToolErrorBody,
  TaskStatusCategory,
  TeamFieldKind,
  ToolErrorCode,
} from './contract/contract.types';

export type { IToolContract } from './generated/contract.generated';
export { TOOL_CONTRACTS } from './generated/contract.generated';

export type {
  ITaskCallContext,
  ITeamDefinition,
  ITeamTool,
  IToolInputSchema,
} from './team/team-definition';
export type { ITeamServerOptions } from './team/team-server';
export { createTeamServer } from './team/team-server';

export { TaskError } from './task/task-error';

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

export { readPairs, requiredEnv, requiredEnvList } from './config/env.helper';
export { serviceAuthFromEnv } from './config/service-auth-env';

export type {
  IServiceCaller,
  IServiceTokenOptions,
  IServiceTokenRequest,
} from './auth/service-token';
export {
  ServiceTokenError,
  signServiceToken,
  taskIdsDigest,
  verifyServiceToken,
} from './auth/service-token';

export { runStdioTeamServer } from './transport/stdio';
export type { IHttpTeamServerOptions } from './transport/http';
export { runHttpTeamServer } from './transport/http';
