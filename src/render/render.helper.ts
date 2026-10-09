import type { JiraFieldValue } from '../contract/contract.types';
import { filled } from '../draft/draft.helper';
import { CUSTOM_FIELD_ID } from '../jira/jira-env.custom-fields';

/**
 * The longest custom field value a host currently accepts. A longer answer is
 * left off the ticket rather than cut short: a truncated value would read as
 * the requester's own, and the full answer still has the description.
 */
const CUSTOM_FIELD_VALUE_MAX_LENGTH = 500;

/**
 * The longest structured value a host currently accepts, measured as the JSON
 * that reaches Jira. Over it, the value is left off like a long string is,
 * rather than failing the whole ticket at the host.
 */
const CUSTOM_FIELD_JSON_MAX_LENGTH = 10_000;

/**
 * The deepest structured value a host currently accepts, counting each list or
 * object as one level. Deeper, the value is left off like a long one is.
 */
const CUSTOM_FIELD_JSON_MAX_DEPTH = 32;

function nestedDeeperThan(value: JiraFieldValue, depth: number): boolean {
  if (typeof value !== 'object' || value === null) return false;

  if (depth === 0) return true;

  return Object.values(value).some(
    (child) => child !== null && nestedDeeperThan(child, depth - 1),
  );
}

/**
 * One entry for `IRenderedTicket.customFields`, or nothing.
 *
 * Returned as an object to spread, so a field with no id configured or no
 * answer is an absent key rather than a blank Jira value:
 *
 * ```ts
 * customFields: {
 *   ...customField(fieldIds.version, fieldValue(draft, 'version')),
 * }
 * ```
 *
 * Which answers become fields is the caller's choice, one call per field —
 * nothing here maps a draft's values wholesale.
 *
 * A structured value — `{ value: 'Ops' }`, a list, an ADF document — is passed
 * on exactly as given; whether it fits the field is Jira's to say. Only the
 * top level is checked: a non-finite number nested inside reaches Jira as
 * `null`.
 *
 * @param fieldId A Jira custom field id, typically from `jiraFieldIdsFromEnv`;
 * absent when this deployment maps no field.
 * @param value This draft's value. A string is trimmed, and blank or longer
 * than 500 characters reads as absent; so do `null`, a number that is not
 * finite, an empty list or object, and a structured value longer than 10 000
 * characters as JSON or nested more than 32 deep.
 * @throws If `fieldId` is given but is not `customfield_<digits>` — a mistake
 * in the team's code or configuration, not in the requester's answer.
 */
export function customField(
  fieldId: string | undefined,
  value: string | null | undefined,
): Readonly<Record<string, string>>;
export function customField(
  fieldId: string | undefined,
  value: JiraFieldValue | null | undefined,
): Readonly<Record<string, JiraFieldValue>>;
export function customField(
  fieldId: string | undefined,
  value: JiraFieldValue | null | undefined,
): Readonly<Record<string, JiraFieldValue>> {
  // `typeof` rather than truthiness: an unconfigured key such as `constructor`
  // reads an inherited function off the mapping, not `undefined`.
  if (typeof fieldId !== 'string' || fieldId.length === 0) return {};

  // Checked before the value, so a bad id fails on every draft rather than
  // only on the ones that happen to answer the field.
  if (!CUSTOM_FIELD_ID.test(fieldId)) {
    throw new Error(
      `customField id "${fieldId}" must be a Jira custom field id, e.g. customfield_14310`,
    );
  }

  if (value === null || value === undefined) return {};

  if (typeof value === 'string') {
    if (!filled(value)) return {};

    const trimmed = value.trim();

    if (trimmed.length > CUSTOM_FIELD_VALUE_MAX_LENGTH) return {};

    return { [fieldId]: trimmed };
  }

  // `NaN` and `Infinity` have no JSON form: they would reach Jira as `null`.
  if (typeof value === 'number' && !Number.isFinite(value)) return {};

  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) return {};

    if (JSON.stringify(value).length > CUSTOM_FIELD_JSON_MAX_LENGTH) return {};

    if (nestedDeeperThan(value, CUSTOM_FIELD_JSON_MAX_DEPTH)) return {};
  }

  return { [fieldId]: value };
}

/** Markdown section, omitted entirely when it has no body. */
export function section(heading: string, body: string | null): string {
  const trimmed = body?.trim();

  return trimmed ? `## ${heading}\n\n${trimmed}` : '';
}

/** A markdown bullet list, omitted entirely when nothing is listed. */
export function bullets(heading: string, items: readonly string[]): string {
  if (items.length === 0) return '';

  return `## ${heading}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/**
 * One `**Label:** value` line, or nothing when the value is absent.
 *
 * Returns `null` rather than an empty string so a list of these narrows to the
 * lines that have a value: `facts.filter((line) => line !== null)`.
 */
export function labelled(label: string, value: string | null): string | null {
  return value ? `**${label}:** ${value}` : null;
}

/** Joins sections, dropping the empty ones so no heading stands alone. */
export function compose(sections: readonly string[]): string {
  return sections.filter((part) => part.length > 0).join('\n\n');
}
