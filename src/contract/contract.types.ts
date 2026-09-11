/**
 * Shapes the contract tools exchange.
 *
 * Declared here for a server's own use. A host is not expected to import them:
 * it re-declares its own and validates every field on the way in, because a
 * shared type across a process boundary is a promise, not a check.
 *
 * The declarations live in three files beside this one — what a team says about
 * itself, what a draft looks like, and what a team answers with. This re-exports
 * them so the contract is still readable, and importable, as one surface.
 */

export type {
  ITeamDescriptor,
  ITeamField,
  ITeamIdentity,
  ITeamJiraMapping,
  TeamFieldKind,
} from './contract.team.types';

export type {
  IIntakeCoreFields,
  IIntakeDraft,
  IIntakeRequester,
} from './contract.draft.types';

export type {
  IDefinitionOfReadyVerdict,
  IReadinessIssue,
  IRenderedTicket,
} from './contract.result.types';
