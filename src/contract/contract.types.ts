/**
 * Shapes the contract tools exchange.
 *
 * Declared here for a server's own use. A host is not expected to import them:
 * it re-declares its own and validates every field on the way in, because a
 * shared type across a process boundary is a promise, not a check.
 *
 * The declarations live in four files beside this one — what a team says about
 * itself, what a draft looks like, what a team answers with, and what a Jira
 * field value may be. This re-exports
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

export type { JiraFieldValue, JiraJsonValue } from './contract.jira.types';
