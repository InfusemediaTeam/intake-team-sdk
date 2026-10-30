/**
 * Shapes the contract tools exchange, generated from `spec/`.
 *
 * Declared here for a server's own use. A host is not expected to import them:
 * it re-declares its own and validates every field on the way in, because a
 * shared type across a process boundary is a promise, not a check.
 */

import type {
  IReadinessVerdict,
  ITaskStatus,
  ITeamField,
} from '../generated/contract.generated';

export type {
  ICreateTaskInput,
  ICreateTaskResult,
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
  ToolErrorCode,
} from '../generated/contract.generated';

/** The 1.x name for a readiness verdict, kept so team code reads the same. */
export type IDefinitionOfReadyVerdict = IReadinessVerdict;

/** How a field is rendered and filled. */
export type TeamFieldKind = ITeamField['kind'];

/** The three states every department's own workflow maps onto. */
export type TaskStatusCategory = ITaskStatus['category'];
