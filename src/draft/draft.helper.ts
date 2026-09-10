import type { IIntakeDraft } from '../contract/contract.types';

/** A present, non-blank value. Blank and absent mean the same thing here. */
export function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function fieldValue(draft: IIntakeDraft, key: string): string | null {
  const value = draft.fieldValues[key];

  return filled(value) ? value.trim() : null;
}

/**
 * Reads a draft out of a tool call's arguments.
 *
 * A server validates its own input for the same reason a host validates a
 * server's output: a caller is a caller. Anything unreadable becomes an empty
 * draft, which fails the readiness check rather than throwing — the host's job
 * is to hear "not ready", not to handle an exception from a validator.
 */
export function toIntakeDraft(args: unknown): IIntakeDraft {
  const source = isRecord(args) ? args : {};
  const draft = isRecord(source.draft) ? source.draft : {};
  const core = isRecord(draft.core) ? draft.core : {};
  const requester = isRecord(draft.requester) ? draft.requester : {};

  return {
    core: {
      title: text(core.title),
      whatNeeded: text(core.whatNeeded),
      urgency: text(core.urgency),
      businessValue: text(core.businessValue),
      approver: text(core.approver),
    },
    fieldValues: stringMap(draft.fieldValues),
    requester: {
      displayName: text(requester.displayName),
      department: text(requester.department),
    },
  };
}

/**
 * The prose of a draft as one lower-cased haystack, for keyword rules.
 *
 * The core fields a requester writes prose into, plus whichever of the team's
 * own fields it names — a signal lands in whichever field the requester
 * happened to explain themselves in, and a title is often terse. The
 * vocabulary being searched for stays with the team; only the gathering is
 * generic.
 */
export function draftProse(
  draft: IIntakeDraft,
  fieldKeys: readonly string[] = [],
): string {
  const parts: readonly (string | null)[] = [
    draft.core.title,
    draft.core.whatNeeded,
    draft.core.businessValue,
    ...fieldKeys.map((key) => fieldValue(draft, key)),
  ];

  return parts
    .filter((part): part is string => filled(part))
    .join(' ')
    .toLowerCase();
}

/** Whether any phrase occurs in the haystack. Phrases are matched as given. */
export function includesAny(
  haystack: string,
  phrases: readonly string[],
): boolean {
  return phrases.some((phrase) => haystack.includes(phrase));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );

  return Object.fromEntries(entries);
}
