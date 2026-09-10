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
 * | Variable                      | Required | Shape                                   |
 * | ----------------------------- | -------- | --------------------------------------- |
 * | `<PREFIX>_JIRA_PROJECT`       | yes      | Project key                             |
 * | `<PREFIX>_JIRA_LABELS`        | yes      | Comma-separated; first is the routing label |
 * | `<PREFIX>_JIRA_ISSUE_TYPE_ID` | no       | Numeric issue type id                   |
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

/** Blank entries dropped, so a trailing comma is not a nameless label. */
function splitList(raw: string): readonly string[] {
  return raw
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
