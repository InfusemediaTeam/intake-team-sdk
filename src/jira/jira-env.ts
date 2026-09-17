import type { ITeamJiraMapping } from '../contract/contract.types';

/**
 * How a team's Jira routing is read from the environment.
 *
 * A project key and a label are properties of a Jira *instance*, not of a team:
 * the same department points at different keys in a sandbox and in production.
 * Compiled in, they force a code change to promote between environments and —
 * worse — a placeholder that looks plausible reaches a real board and is
 * rejected there.
 *
 * What stays in code is the part that is genuinely the team's own: its issue
 * type, its intake fields, its Definition of Ready and how it renders a ticket.
 */

/** Separates entries in a list-valued variable, e.g. `intake,triage`. */
const LIST_SEPARATOR = ',';

/** Separates a custom field's id from its value, e.g. `customfield_10200=Ops`. */
const PAIR_SEPARATOR = '=';

/**
 * The only shape a Jira custom field id has. Enforced for the same reason the
 * issue type id is: the easy mistake is configuring the field's *name*, and a
 * board answers that with a rejection that names nothing useful.
 */
const CUSTOM_FIELD_ID = /^customfield_\d+$/;

/**
 * Deliberately not RFC 5322. Telling an address apart from an account id or a
 * display name is the whole job here, and a stricter pattern buys nothing for
 * it while rejecting addresses a Jira instance would have accepted.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The team decisions the caller supplies rather than reads from the env. */
export interface IJiraMappingOptions {
  /**
   * `Task`, `Story`, `Bug` — the team's own intent, so it is not configuration.
   *
   * These are names Jira ships with, so they survive a move between instances
   * in a way that a project key or a field id does not.
   */
  readonly issueType: string;
}

/**
 * One team's Jira mapping, read from `<PREFIX>_JIRA_*`.
 *
 * Call it at module load, so a missing required variable stops the server
 * starting rather than surfacing when someone confirms a draft. The host then
 * reports that department as unavailable, which is the honest answer: a server
 * that started without knowing where its tickets go would route them somewhere
 * wrong and look healthy doing it.
 *
 * The prefix is the whole isolation mechanism — a server reads its own
 * variables and nothing else, so it cannot route onto a board it was not
 * configured for even by accident.
 *
 * | Variable                       | Required | Shape                                   |
 * | ------------------------------ | -------- | --------------------------------------- |
 * | `<PREFIX>_JIRA_PROJECT`        | yes      | Project key                             |
 * | `<PREFIX>_JIRA_LABELS`         | yes      | Comma-separated; first is the routing label |
 * | `<PREFIX>_JIRA_ISSUE_TYPE_ID`  | no       | Numeric issue type id                   |
 * | `<PREFIX>_JIRA_ASSIGNEE_EMAIL` | no       | Account email to assign tickets to      |
 * | `<PREFIX>_JIRA_CUSTOM_FIELDS`  | no       | Comma-separated `customfield_<id>=value` |
 *
 * @param prefix Upper-case team prefix, e.g. `EXAMPLE` for `EXAMPLE_JIRA_PROJECT`.
 * @throws If a required variable is absent or blank, naming the variable.
 */
export function jiraMappingFromEnv(
  prefix: string,
  options: IJiraMappingOptions,
): ITeamJiraMapping {
  return {
    boardKey: requiredEnv(`${prefix}_JIRA_PROJECT`),
    issueType: options.issueType,
    // Required: a host reports the first label back to the requester as the
    // routing label, so an unlabelled mapping would leave a created ticket with
    // nothing to name where it went.
    labels: requiredEnvList(`${prefix}_JIRA_LABELS`),
    ...optionalIssueTypeId(prefix),
    ...optionalAssigneeEmail(prefix),
    ...optionalCustomFields(prefix),
  };
}

/**
 * A configured, non-blank value.
 *
 * The variable is named in the failure because the alternative — a boot that
 * dies on "cannot read property of undefined" — says nothing about which of a
 * deployment's settings is missing.
 *
 * @throws If the variable is absent or blank.
 */
export function requiredEnv(name: string): string {
  const raw = process.env[name];

  if (raw === undefined || raw.trim().length === 0) {
    throw new Error(`${name} is required and must not be blank`);
  }

  return raw.trim();
}

/**
 * A required comma-separated list, with at least one entry.
 *
 * @throws If the variable is absent, blank, or lists nothing.
 */
export function requiredEnvList(name: string): readonly string[] {
  const entries = splitList(requiredEnv(name));

  if (entries.length === 0) {
    throw new Error(`${name} must list at least one value`);
  }

  return entries;
}

/**
 * `<PREFIX>_JIRA_ISSUE_TYPE_ID`, when this team sets one.
 *
 * Optional on purpose. A team sharing a project with others inherits the
 * host's configured default and needs nothing here; a team whose board has its
 * own type scheme sets this and stops being overridden by that default.
 *
 * Spread as an absent key rather than an explicit `undefined`, so the
 * descriptor on the wire says nothing at all when nothing was configured.
 */
function optionalIssueTypeId(prefix: string): {
  readonly issueTypeId?: string;
} {
  const name = `${prefix}_JIRA_ISSUE_TYPE_ID`;
  const raw = process.env[name];

  if (raw === undefined || raw.trim().length === 0) return {};

  const value = raw.trim();

  // Digits only: the easy mistake is configuring the type's name here, and
  // Jira answers that with the same "Specify a valid issue type" an id exists
  // to avoid.
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a numeric Jira id, e.g. 99977`);
  }

  return { issueTypeId: value };
}

/**
 * `<PREFIX>_JIRA_ASSIGNEE_EMAIL`, when this team assigns its tickets.
 *
 * Optional on purpose. A team that triages from its own board sets nothing and
 * its tickets are created unassigned; a team that routes to one owner sets this
 * and the host assigns to that account.
 *
 * An email rather than an account id for the same reason the issue type is a
 * name: an id is minted per instance, so it would have to be re-looked-up to
 * promote between a sandbox and production.
 *
 * Lower-cased as well as trimmed, so a mapping is one value however the address
 * was capitalised in the environment: the descriptor goes to a host, and a host
 * is free to compare the string rather than ask Jira to resolve it.
 *
 * Spread as an absent key rather than an explicit `undefined`, so the
 * descriptor on the wire says nothing at all when nothing was configured.
 *
 * @throws If a value is configured but is not shaped like an email address.
 */
function optionalAssigneeEmail(prefix: string): {
  readonly assigneeEmail?: string;
} {
  const name = `${prefix}_JIRA_ASSIGNEE_EMAIL`;
  const raw = process.env[name];

  if (raw === undefined || raw.trim().length === 0) return {};

  const value = raw.trim().toLowerCase();

  // Rejected here rather than at the board: the easy mistakes are configuring
  // an account id or a display name, and both start a server that looks healthy
  // and only fails once a host tries to assign a real ticket.
  if (!EMAIL_SHAPE.test(value)) {
    throw new Error(`${name} must be an account email, e.g. owner@example.com`);
  }

  return { assigneeEmail: value };
}

/**
 * `<PREFIX>_JIRA_CUSTOM_FIELDS` configures Jira custom fields required by this team.
 *
 * Optional by design: teams without custom fields behave exactly as before.
 * IDs are configured via environment variables because Jira field IDs differ
 * between instances (for example, sandbox vs production).
 *
 * Format: `customfield_10200=Ops,customfield_10201=Q3`
 * Comma-separated pairs, split on the first `=`. Values may contain `=`, but
 * not commas.
 *
 * The descriptor omits `customFields` completely when nothing is configured.
 *
 * @throws If entries are invalid, field IDs are malformed, values are blank,
 * or duplicate IDs are configured.
 */
function optionalCustomFields(prefix: string): {
  readonly customFields?: Readonly<Record<string, string>>;
} {
  const name = `${prefix}_JIRA_CUSTOM_FIELDS`;
  const raw = process.env[name];

  if (raw === undefined || raw.trim().length === 0) return {};

  const customFields: Record<string, string> = {};

  for (const entry of splitList(raw)) {
    const separator = entry.indexOf(PAIR_SEPARATOR);

    if (separator === -1) {
      throw new Error(
        `${name} entry "${entry}" must be id=value, e.g. customfield_10200=Ops`,
      );
    }

    const id = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();

    if (!CUSTOM_FIELD_ID.test(id)) {
      throw new Error(
        `${name} id "${id}" must be a Jira custom field id, e.g. customfield_10200`,
      );
    }

    if (value.length === 0) {
      throw new Error(`${name} value for ${id} must not be blank`);
    }

    // Refused rather than last-wins: a repeated id is a mistake in the
    // deployment, and silently keeping one of the two values puts whichever
    // was not meant onto every ticket this team files.
    if (id in customFields) {
      throw new Error(`${name} lists ${id} more than once`);
    }

    customFields[id] = value;
  }

  return { customFields };
}

/** Blank entries dropped, so a trailing comma is not a nameless label. */
function splitList(raw: string): readonly string[] {
  return raw
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
