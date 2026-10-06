import { filled } from '../draft/draft.helper';

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
 * @param value This draft's value; trimmed, and blank read as absent.
 */
export function customField(
  fieldId: string | undefined,
  value: string | null | undefined,
): Readonly<Record<string, string>> {
  // `typeof` rather than truthiness: an unconfigured key such as `constructor`
  // reads an inherited function off the mapping, not `undefined`.
  if (typeof fieldId !== 'string' || fieldId.length === 0) return {};
  if (typeof value !== 'string' || !filled(value)) return {};

  return { [fieldId]: value.trim() };
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
