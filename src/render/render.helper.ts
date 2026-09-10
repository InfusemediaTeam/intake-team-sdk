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
