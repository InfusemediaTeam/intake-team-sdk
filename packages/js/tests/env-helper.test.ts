import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  readPairs,
  requiredEnv,
  requiredEnvList,
} from '../src/config/env.helper';
import { serviceAuthFromEnv } from '../src/config/service-auth-env';

const NAMES = [
  'SDK_TEST_VALUE',
  'SDK_TEST_LIST',
  'EXAMPLE_MCP_JWT_SECRET',
  'EXAMPLE_MCP_JWT_ISSUER',
  'EXAMPLE_MCP_JWT_AUDIENCE',
];

describe('env helpers', () => {
  afterEach(() => {
    for (const name of NAMES) delete process.env[name];
  });

  it('reads a required value trimmed, and names a missing one', () => {
    process.env.SDK_TEST_VALUE = '  value ';

    assert.equal(requiredEnv('SDK_TEST_VALUE'), 'value');

    process.env.SDK_TEST_VALUE = '   ';

    assert.throws(
      () => requiredEnv('SDK_TEST_VALUE'),
      /SDK_TEST_VALUE is required/,
    );
  });

  it('reads a list, dropping blank entries, and refuses an empty one', () => {
    process.env.SDK_TEST_LIST = 'a, b,,';

    assert.deepEqual(requiredEnvList('SDK_TEST_LIST'), ['a', 'b']);

    process.env.SDK_TEST_LIST = ' , ';

    assert.throws(
      () => requiredEnvList('SDK_TEST_LIST'),
      /must list at least one value/,
    );
  });

  it('reads pairs split on the first separator and refuses duplicates', () => {
    assert.deepEqual(
      readPairs('X', 'a=1, b=x=y', 'k=v', () => undefined),
      { a: '1', b: 'x=y' },
    );
    assert.throws(
      () => readPairs('X', 'a=1,a=2', 'k=v', () => undefined),
      /lists a more than once/,
    );
    assert.throws(
      () => readPairs('X', 'nope', 'k=v', () => undefined),
      /must be k=v/,
    );
  });

  it('reads service-token settings by prefix', () => {
    process.env.EXAMPLE_MCP_JWT_SECRET = 's'.repeat(32);
    process.env.EXAMPLE_MCP_JWT_ISSUER = 'example-host';
    process.env.EXAMPLE_MCP_JWT_AUDIENCE = 'example';

    assert.deepEqual(serviceAuthFromEnv('EXAMPLE'), {
      secret: 's'.repeat(32),
      issuer: 'example-host',
      audience: 'example',
    });

    delete process.env.EXAMPLE_MCP_JWT_AUDIENCE;

    assert.throws(
      () => serviceAuthFromEnv('EXAMPLE'),
      /EXAMPLE_MCP_JWT_AUDIENCE is required/,
    );
  });
});
