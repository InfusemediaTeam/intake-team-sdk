import { filled } from '../draft/draft.helper';
import { CUSTOM_FIELD_ID } from '../jira/jira-env.custom-fields';

/**
 * The longest custom field value a host currently accepts. A longer answer is
 * left off the ticket rather than cut short: a truncated value would read as
 * the requester's own, and the full answer still has the description.
 */
const CUSTOM_FIELD_VALUE_MAX_LENGTH = 500;

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
 * @param fieldId A Jira custom field id, typically from `jiraFieldIdsFromEnv`;
 * absent when this deployment maps no field.
 * @param value This draft's value; trimmed, and blank or longer than 500
 * characters read as absent.
 * @throws If `fieldId` is given but is not `customfield_<digits>` — a mistake
 * in the team's code or configuration, not in the requester's answer.
 */
export function customField(
  fieldId: string | undefined,
  value: string | null | undefined,
): Readonly<Record<string, string>> {
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

  if (typeof value !== 'string' || !filled(value)) return {};

  const trimmed = value.trim();

  if (trimmed.length > CUSTOM_FIELD_VALUE_MAX_LENGTH) return {};

  return { [fieldId]: trimmed };
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
