/**
 * Shapes the contract tools exchange.
 *
 * Declared here for a server's own use. A host is not expected to import them:
 * it re-declares its own and validates every field on the way in, because a
 * shared type across a process boundary is a promise, not a check.
 */

/** How a field is rendered and filled. */
export type TeamFieldKind = 'text' | 'longText' | 'enum';

/** One team-specific question, beyond the host's core fields. */
export interface ITeamField {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly kind: TeamFieldKind;
  readonly required: boolean;
  /** Allowed values; only meaningful when `kind` is `enum`. */
  readonly options?: readonly string[];
}

/** Where this team's tickets land, and how they are tagged. */
export interface ITeamJiraMapping {
  readonly boardKey: string;
  /** The readable type name. A host opens issues by id, not by this. */
  readonly issueType: string;
  /**
   * Numeric Jira issue type id, when this team has confirmed one.
   *
   * Optional because it is instance-specific. Absent means "use the host's
   * configured default", which is right for a team that shares a project with
   * others; set it when this team's board has a different type scheme.
   */
  readonly issueTypeId?: string;
  readonly labels: readonly string[];
}

/** Who the team is, as the requester is offered it. */
export interface ITeamIdentity {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
}

export interface ITeamDescriptor {
  readonly contractVersion: string;
  readonly team: ITeamIdentity;
  readonly jira: ITeamJiraMapping;
  readonly fields: readonly ITeamField[];
  /**
   * Conditional readiness rules, in plain language.
   *
   * The host's assistant is shown these so it can ask ahead of time instead of
   * being refused at confirmation. A rule that only exists inside `validate` is
   * one the requester meets by trial and error.
   */
  readonly readinessNotes: readonly string[];
}

/** The host's own fields, which every team receives. */
export interface IIntakeCoreFields {
  readonly title: string | null;
  readonly whatNeeded: string | null;
  readonly urgency: string | null;
  readonly businessValue: string | null;
  readonly approver: string | null;
}

/**
 * Who asked, as far as a team MCP is told.
 *
 * Identity beyond a display name and a department is deliberately not part of
 * the contract: one of these servers may be reached over a network it does not
 * control, and a ticket template needs a name at most.
 */
export interface IIntakeRequester {
  readonly displayName: string | null;
  readonly department: string | null;
}

/** One draft, as the host presents it for validation or rendering. */
export interface IIntakeDraft {
  readonly core: IIntakeCoreFields;
  readonly fieldValues: Readonly<Record<string, string>>;
  readonly requester: IIntakeRequester;
}

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
