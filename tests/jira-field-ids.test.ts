import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { jiraFieldIdsFromEnv, jiraMappingFromEnv } from '../src/jira/jira-env';

const PREFIX = 'TESTTEAM';
const OPTIONS = { issueType: 'Task' } as const;

/** Every variable this suite writes, so each case starts from a clean slate. */
const VARIABLES: readonly string[] = [
  `${PREFIX}_JIRA_PROJECT`,
  `${PREFIX}_JIRA_LABELS`,
  `${PREFIX}_JIRA_ISSUE_TYPE_ID`,
  `${PREFIX}_JIRA_ASSIGNEE_EMAIL`,
  `${PREFIX}_JIRA_CUSTOM_FIELDS`,
  `${PREFIX}_JIRA_FIELD_IDS`,
];

/**
 * Deleted rather than assigned `undefined`: assigning stores the string
 * `"undefined"`, which is not what "not configured" means.
 */
const given = (env: Readonly<Record<string, string>>): void => {
  for (const name of VARIABLES) delete process.env[name];
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
};

/** The smallest configuration that resolves, so a case can vary one thing. */
const complete = (
  overrides: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> => ({
  [`${PREFIX}_JIRA_PROJECT`]: 'TT',
  [`${PREFIX}_JIRA_LABELS`]: 'intake',
  ...overrides,
});

/** The whole environment, restored after every case. */
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('jiraFieldIdsFromEnv', () => {
  const NAME = `${PREFIX}_JIRA_FIELD_IDS`;

  const fieldIds = (
    env: Readonly<Record<string, string>>,
  ): ReturnType<typeof jiraFieldIdsFromEnv> => {
    given(env);

    return jiraFieldIdsFromEnv(PREFIX);
  };

  it('reads nothing when the variable is absent or blank', () => {
    // Optional like every other `_JIRA_*` beyond the required two: a team that
    // maps no answer onto a Jira field configures nothing.
    assert.deepEqual(fieldIds({}), {});
    assert.deepEqual(fieldIds({ [NAME]: '   ' }), {});
  });

  it('maps one field key to its id', () => {
    assert.deepEqual(fieldIds({ [NAME]: 'version=customfield_14310' }), {
      version: 'customfield_14310',
    });
  });

  it('reads every configured pair, trimmed', () => {
    assert.deepEqual(
      fieldIds({
        [NAME]:
          ' version = customfield_14310 , environment=customfield_14311 ,',
      }),
      { version: 'customfield_14310', environment: 'customfield_14311' },
    );
  });

  it('splits on the first separator', () => {
    // So the id half is `customfield_14310=x` and refused, rather than the
    // entry being read as some other pair.
    given({ [NAME]: 'version=customfield_14310=x' });

    assert.throws(() => jiraFieldIdsFromEnv(PREFIX), {
      message: /TESTTEAM_JIRA_FIELD_IDS id "customfield_14310=x"/,
    });
  });

  it('accepts a key a plain object would already appear to hold', () => {
    assert.deepEqual(fieldIds({ [NAME]: 'toString=customfield_14310' }), {
      toString: 'customfield_14310',
    });
  });

  it('refuses an entry that is not a pair', () => {
    given({ [NAME]: 'version' });

    assert.throws(() => jiraFieldIdsFromEnv(PREFIX), {
      message: /TESTTEAM_JIRA_FIELD_IDS entry "version" must be key=id/,
    });
  });

  it('refuses an entry with no field key', () => {
    given({ [NAME]: '=customfield_14310' });

    assert.throws(() => jiraFieldIdsFromEnv(PREFIX), { message: /field key/ });
  });

  it('refuses anything that is not a custom field id', () => {
    // The easy mistake is configuring the Jira field's *name* or a bare number.
    const refused: readonly string[] = [
      'version=Version',
      'version=14310',
      'version=customfield_',
      'version=customfield_abc',
      'version=',
    ];

    refused.forEach((entry) => {
      given({ [NAME]: entry });

      assert.throws(
        () => jiraFieldIdsFromEnv(PREFIX),
        { message: /TESTTEAM_JIRA_FIELD_IDS/ },
        `expected ${entry} to be refused`,
      );
    });
  });

  it('refuses the same field key twice rather than picking one of the ids', () => {
    given({ [NAME]: 'version=customfield_14310,version=customfield_14311' });

    assert.throws(() => jiraFieldIdsFromEnv(PREFIX), {
      message: /TESTTEAM_JIRA_FIELD_IDS lists version more than once/,
    });
  });

  it('refuses the same id under two field keys rather than letting one win', () => {
    given({
      [NAME]: 'version=customfield_14310,environment=customfield_14310',
    });

    assert.throws(() => jiraFieldIdsFromEnv(PREFIX), {
      message:
        /TESTTEAM_JIRA_FIELD_IDS maps customfield_14310 to both version and environment/,
    });
  });

  it('is independent of the fixed custom fields', () => {
    // Each variable means something different — an id to fill per draft, and
    // an id with a fixed value — so neither may leak into the other.
    given(
      complete({
        [`${PREFIX}_JIRA_CUSTOM_FIELDS`]: 'customfield_10200=Ops',
        [NAME]: 'version=customfield_14310',
      }),
    );

    assert.deepEqual(jiraFieldIdsFromEnv(PREFIX), {
      version: 'customfield_14310',
    });
    assert.deepEqual(jiraMappingFromEnv(PREFIX, OPTIONS).customFields, {
      customfield_10200: 'Ops',
    });
  });
});
