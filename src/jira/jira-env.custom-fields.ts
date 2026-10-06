import { readPairs } from './jira-env.helper';

/**
 * The only shape a Jira custom field id has. Enforced for the same reason the
 * issue type id is: the easy mistake is configuring the field's *name*, and a
 * board answers that with a rejection that names nothing useful.
 */
const CUSTOM_FIELD_ID = /^customfield_\d+$/;

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
export function optionalCustomFields(prefix: string): {
  readonly customFields?: Readonly<Record<string, string>>;
} {
  const name = `${prefix}_JIRA_CUSTOM_FIELDS`;
  const raw = process.env[name];

  if (raw === undefined || raw.trim().length === 0) return {};

  const customFields = readPairs(
    name,
    raw,
    'id=value, e.g. customfield_10200=Ops',
    (id, value) => {
      if (!CUSTOM_FIELD_ID.test(id)) {
        throw new Error(
          `${name} id "${id}" must be a Jira custom field id, e.g. customfield_10200`,
        );
      }

      if (value.length === 0) {
        throw new Error(`${name} value for ${id} must not be blank`);
      }
    },
  );

  return { customFields };
}

/**
 * `<PREFIX>_JIRA_FIELD_IDS`: which Jira custom field each of the team's own
 * field keys fills, e.g. `version=customfield_14310`.
 *
 * The id is configuration for the same reason as everywhere else here — it is
 * minted per Jira instance. The *value* is not: it is the requester's answer,
 * so it is supplied per draft by `render`, through `IRenderedTicket.customFields`.
 * That is the difference from `<PREFIX>_JIRA_CUSTOM_FIELDS`, whose values are
 * fixed and land on every ticket.
 *
 * Mapping a key here does not put its answer on a ticket by itself: `render`
 * decides which answers become fields, so a key nobody reads is inert.
 *
 * Kept out of the descriptor: a host needs only the resolved `id → value`, and
 * what each id is filled from is the team's own business.
 *
 * Call it at module load, like `jiraMappingFromEnv`, so a malformed mapping
 * stops the server starting. Absent or blank reads as an empty mapping.
 *
 * @param prefix Upper-case team prefix, e.g. `EXAMPLE` for `EXAMPLE_JIRA_FIELD_IDS`.
 * @throws If an entry is not `key=id`, a key is blank, an id is not a custom
 * field id, a key is listed twice, or an id is mapped from two keys.
 */
export function jiraFieldIdsFromEnv(
  prefix: string,
): Readonly<Record<string, string>> {
  const name = `${prefix}_JIRA_FIELD_IDS`;
  const raw = process.env[name];

  if (raw === undefined || raw.trim().length === 0) return {};

  const fieldIds = readPairs(
    name,
    raw,
    'key=id, e.g. version=customfield_14310',
    (key, id) => {
      if (key.length === 0) {
        throw new Error(`${name} entry for ${id} must name a field key`);
      }

      if (!CUSTOM_FIELD_ID.test(id)) {
        throw new Error(
          `${name} id "${id}" for ${key} must be a Jira custom field id, e.g. customfield_14310`,
        );
      }
    },
  );

  // Refused for the same reason as a repeated key: two answers filling one
  // field means whichever `render` spreads last silently wins.
  const keysById = new Map<string, string>();

  for (const [key, id] of Object.entries(fieldIds)) {
    const earlier = keysById.get(id);

    if (earlier !== undefined) {
      throw new Error(`${name} maps ${id} to both ${earlier} and ${key}`);
    }

    keysById.set(id, key);
  }

  return fieldIds;
}
