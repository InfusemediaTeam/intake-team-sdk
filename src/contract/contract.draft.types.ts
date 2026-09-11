/**
 * One intake request in progress, as a host hands it to a team for validation
 * or rendering.
 */

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
