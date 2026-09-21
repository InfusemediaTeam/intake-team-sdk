/**
 * What a team declares about itself, as `intake_get_team_descriptor` returns it.
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
  /**
   * Account email of the person this team's tickets are assigned to.
   *
   * Optional because it is instance-specific, and because assignment is a
   * choice rather than a requirement. Absent means "leave it unassigned", so a
   * team that triages from its board is unaffected; set it when created tickets
   * should land on one person instead of an open queue.
   */
  readonly assigneeEmail?: string;
  /**
   * Jira custom field id → value, e.g. `customfield_10200`.
   *
   * Optional because both halves are instance-specific: the id is minted per
   * Jira instance, and a team that fills none of them says nothing here. Absent
   * means "set no custom fields", which leaves a ticket exactly as it is
   * created today; set it when this team's board requires one.
   */
  readonly customFields?: Readonly<Record<string, string>>;
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
