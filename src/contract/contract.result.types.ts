/**
 * What a team answers with: a readiness verdict, and a rendered ticket.
 */

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
}
