/**
 * What a team answers with: a readiness verdict, and a rendered ticket.
 */

import type { JiraFieldValue } from './contract.jira.types';

/** One thing standing between the draft and readiness. */
export interface IReadinessIssue {
  /** The field it is about, when it is about one. */
  readonly field?: string;
  readonly message: string;
}

export interface IDefinitionOfReadyVerdict {
  readonly ready: boolean;
  /** Empty when ready. Each one names something the assistant must collect. */
  readonly blockers: readonly IReadinessIssue[];
  /** Worth having, never blocking. */
  readonly warnings: readonly IReadinessIssue[];
}

export interface IRenderedTicket {
  readonly description: string;
  /** Overrides the host's summary when the team wants its own convention. */
  readonly summary?: string;
  /**
   * Jira custom field id → value for *this* draft, e.g. `customfield_14310`.
   *
   * The per-request counterpart of the descriptor's `jira.customFields`, which
   * holds values fixed for every ticket a team files. Optional because a team
   * that maps no answer onto a Jira field says nothing here, and its tickets are
   * created exactly as before. A value is any JSON the field takes — a string,
   * `{ value: 'Ops' }`, a list — and whether it fits the field is Jira's to say.
   *
   * A string value is at most 500 characters, the host's current validation
   * limit. `customField()` leaves a longer answer out rather than truncating it.
   */
  readonly customFields?: Readonly<Record<string, JiraFieldValue>>;
}
