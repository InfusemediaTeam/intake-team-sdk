/**
 * Reading variables out of the environment, shared by the Jira readers beside
 * this file: a required value, a required list, and a list of `left=right`
 * pairs.
 */

/** Separates entries in a list-valued variable, e.g. `intake,triage`. */
const LIST_SEPARATOR = ',';

/** Separates a custom field's id from its value, e.g. `customfield_10200=Ops`. */
const PAIR_SEPARATOR = '=';

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
 * A comma-separated list of `left=right` pairs, split on the first `=` and
 * trimmed, with `check` judging each pair before it is kept.
 *
 * @throws If an entry has no separator, `check` refuses a pair, or a left-hand
 * side is listed twice.
 */
export function readPairs(
  name: string,
  raw: string,
  shape: string,
  check: (left: string, right: string) => void,
): Readonly<Record<string, string>> {
  // A Map rather than an object literal: a field key is free text, and `in` on
  // a plain object would call `toString` a duplicate of itself.
  const pairs = new Map<string, string>();

  for (const entry of splitList(raw)) {
    const separator = entry.indexOf(PAIR_SEPARATOR);

    if (separator === -1) {
      throw new Error(`${name} entry "${entry}" must be ${shape}`);
    }

    const left = entry.slice(0, separator).trim();
    const right = entry.slice(separator + 1).trim();

    check(left, right);

    // Refused rather than last-wins: a repeated entry is a mistake in the
    // deployment, and silently keeping one of the two puts whichever was not
    // meant onto every ticket this team files.
    if (pairs.has(left)) {
      throw new Error(`${name} lists ${left} more than once`);
    }

    pairs.set(left, right);
  }

  return Object.fromEntries(pairs);
}

/** Blank entries dropped, so a trailing comma is not a nameless label. */
function splitList(raw: string): readonly string[] {
  return raw
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
