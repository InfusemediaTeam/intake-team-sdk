import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  jiraMappingFromEnv,
  requiredEnv,
  requiredEnvList,
} from '../src/jira/jira-env';

const PREFIX = 'TESTTEAM';
const OPTIONS = { issueType: 'Task' } as const;

/** Every variable this suite writes, so each case starts from a clean slate. */
const VARIABLES: readonly string[] = [
  `${PREFIX}_JIRA_PROJECT`,
  `${PREFIX}_JIRA_LABELS`,
  `${PREFIX}_JIRA_ISSUE_TYPE_ID`,
  `${PREFIX}_JIRA_ASSIGNEE_EMAIL`,
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

const mapping = (
  env: Readonly<Record<string, string>>,
): ReturnType<typeof jiraMappingFromEnv> => {
  given(env);

  return jiraMappingFromEnv(PREFIX, OPTIONS);
};

/**
 * The whole environment, restored after every case.
 *
 * Wholesale rather than deleting the names a case wrote: several cases set
 * variables outside {@link VARIABLES}, and a failing assertion skips whatever
 * cleanup sits after it — leaving the next case to run against settings it
 * never asked for.
 */
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/**
 * One team's settings must never reach another's server.
 *
 * The prefix is the whole isolation mechanism, asserted here rather than
 * trusted, because the failure mode — tickets quietly landing on the wrong
 * team's board — looks like working software.
 */
describe('team isolation', () => {
  const PREFIXES = ['ALPHA', 'BETA'] as const;

  const givenEveryTeamConfigured = (): void => {
    for (const prefix of PREFIXES) {
      process.env[`${prefix}_JIRA_PROJECT`] = `${prefix}PROJ`;
      process.env[`${prefix}_JIRA_LABELS`] = `${prefix.toLowerCase()}-label`;
    }
  };

  it('reads only its own prefix when every team is configured', () => {
    givenEveryTeamConfigured();

    for (const prefix of PREFIXES) {
      const result = jiraMappingFromEnv(prefix, OPTIONS);

      assert.equal(result.boardKey, `${prefix}PROJ`);
      assert.deepEqual(result.labels, [`${prefix.toLowerCase()}-label`]);
    }
  });

  it("fails rather than borrowing another team's project", () => {
    process.env.BETA_JIRA_PROJECT = 'BETAPROJ';
    process.env.BETA_JIRA_LABELS = 'beta-label';

    // ALPHA is unconfigured while BETA is. A server that fell back to whatever
    // was present would file its tickets onto the other team's board.
    assert.throws(() => jiraMappingFromEnv('ALPHA', OPTIONS), {
      message: /ALPHA_JIRA_PROJECT/,
    });
  });

  it('never reads a credential into the mapping', () => {
    givenEveryTeamConfigured();
    process.env.JIRA_BASE_URL = 'https://example.invalid';
    process.env.JIRA_EMAIL = 'someone@example.invalid';
    process.env.JIRA_API_TOKEN = 'placeholder-secret';

    // A team server renders tickets; the host is the only process that calls
    // Jira. A credential reaching a descriptor would put it on the wire.
    const serialised = JSON.stringify(jiraMappingFromEnv('ALPHA', OPTIONS));

    assert.equal(serialised.includes('placeholder-secret'), false);
    assert.equal(serialised.includes('example.invalid'), false);
  });
});

describe('jiraMappingFromEnv', () => {
  it('reads a full mapping from the environment', () => {
    const result = mapping(
      complete({ [`${PREFIX}_JIRA_LABELS`]: 'intake,triage' }),
    );

    assert.deepEqual(result, {
      boardKey: 'TT',
      issueType: 'Task',
      labels: ['intake', 'triage'],
    });
  });

  it('takes the issue type from code, never from the environment', () => {
    // The one part of the mapping that is the team's own decision: it survives
    // a move between Jira instances, so configuring it would invite drift.
    process.env[`${PREFIX}_JIRA_ISSUE_TYPE`] = 'Bug';

    assert.equal(mapping(complete()).issueType, 'Task');
  });

  describe('the optional issue type id', () => {
    it('is absent from the mapping when nothing is configured', () => {
      // An absent key rather than an explicit `undefined`, so the descriptor on
      // the wire says nothing at all and the host applies its own default.
      assert.equal('issueTypeId' in mapping(complete()), false);
    });

    it('is carried through when it is numeric', () => {
      const result = mapping(
        complete({ [`${PREFIX}_JIRA_ISSUE_TYPE_ID`]: ' 99977 ' }),
      );

      assert.equal(result.issueTypeId, '99977');
    });

    it('refuses a name where an id belongs', () => {
      given(complete({ [`${PREFIX}_JIRA_ISSUE_TYPE_ID`]: 'Task' }));

      assert.throws(() => jiraMappingFromEnv(PREFIX, OPTIONS), {
        message: /TESTTEAM_JIRA_ISSUE_TYPE_ID/,
      });
    });
  });

  describe('the optional assignee email', () => {
    it('is absent from the mapping when nothing is configured', () => {
      // An absent key rather than an explicit `undefined`, so the descriptor on
      // the wire says nothing at all and the ticket is created unassigned.
      assert.equal('assigneeEmail' in mapping(complete()), false);
    });

    it('is carried through, trimmed, when it is configured', () => {
      const result = mapping(
        complete({
          [`${PREFIX}_JIRA_ASSIGNEE_EMAIL`]: '  owner@example.invalid  ',
        }),
      );

      assert.equal(result.assigneeEmail, 'owner@example.invalid');
    });

    it('treats a blank value as unconfigured', () => {
      const result = mapping(
        complete({ [`${PREFIX}_JIRA_ASSIGNEE_EMAIL`]: '   ' }),
      );

      assert.equal('assigneeEmail' in result, false);
    });

    it('lower-cases the address it carries through', () => {
      // One value however the environment capitalised it, so a host comparing
      // the string rather than resolving it through Jira still matches.
      const result = mapping(
        complete({
          [`${PREFIX}_JIRA_ASSIGNEE_EMAIL`]: ' Owner@Example.INVALID ',
        }),
      );

      assert.equal(result.assigneeEmail, 'owner@example.invalid');
    });

    it('refuses a value that is not shaped like an address', () => {
      // The two easy mistakes are an account id and a display name; both start
      // a healthy-looking server and fail only when a host assigns a ticket.
      const refused: readonly string[] = [
        '5b10a2844c20165700ede21g',
        'Anna K.',
        'owner@example',
        'owner example.invalid',
        'owner@ example.invalid',
        '@example.invalid',
      ];

      refused.forEach((value) => {
        given(complete({ [`${PREFIX}_JIRA_ASSIGNEE_EMAIL`]: value }));

        assert.throws(
          () => jiraMappingFromEnv(PREFIX, OPTIONS),
          { message: /TESTTEAM_JIRA_ASSIGNEE_EMAIL/ },
          `expected ${value} to be refused`,
        );
      });
    });
  });

  describe('required values', () => {
    it('names the missing project key', () => {
      given({ [`${PREFIX}_JIRA_LABELS`]: 'intake' });

      assert.throws(() => jiraMappingFromEnv(PREFIX, OPTIONS), {
        message: /TESTTEAM_JIRA_PROJECT/,
      });
    });

    it('names the missing labels', () => {
      given({ [`${PREFIX}_JIRA_PROJECT`]: 'TT' });

      assert.throws(() => jiraMappingFromEnv(PREFIX, OPTIONS), {
        message: /TESTTEAM_JIRA_LABELS/,
      });
    });

    it('treats a blank value as missing', () => {
      // A variable declared but never filled in is the common case, and it must
      // fail exactly as an absent one does.
      given(complete({ [`${PREFIX}_JIRA_PROJECT`]: '   ' }));

      assert.throws(() => jiraMappingFromEnv(PREFIX, OPTIONS), {
        message: /TESTTEAM_JIRA_PROJECT/,
      });
    });

    it('rejects a label list that holds no labels', () => {
      given(complete({ [`${PREFIX}_JIRA_LABELS`]: ',,' }));

      assert.throws(() => jiraMappingFromEnv(PREFIX, OPTIONS), {
        message: /TESTTEAM_JIRA_LABELS/,
      });
    });

    it('trims entries and drops a trailing separator', () => {
      const result = mapping(
        complete({ [`${PREFIX}_JIRA_LABELS`]: ' intake , triage , ' }),
      );

      assert.deepEqual(result.labels, ['intake', 'triage']);
    });
  });
});

describe('requiredEnv and requiredEnvList', () => {
  it('trims the value it returns', () => {
    process.env.SDK_TEST_VALUE = '  present  ';

    assert.equal(requiredEnv('SDK_TEST_VALUE'), 'present');
  });

  it('names the variable it could not read', () => {
    delete process.env.SDK_TEST_VALUE;

    assert.throws(() => requiredEnv('SDK_TEST_VALUE'), {
      message: /SDK_TEST_VALUE/,
    });
    assert.throws(() => requiredEnvList('SDK_TEST_VALUE'), {
      message: /SDK_TEST_VALUE/,
    });
  });
});
