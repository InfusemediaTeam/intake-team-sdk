import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isBearerAuthorized } from '../src/transport/bearer-auth';

describe('isBearerAuthorized', () => {
  it('accepts the expected token', () => {
    assert.equal(isBearerAuthorized('Bearer secret', 'secret'), true);
  });

  it('tolerates trailing whitespace around the token', () => {
    assert.equal(isBearerAuthorized('Bearer  secret  ', 'secret'), true);
  });

  it('refuses a wrong, absent or malformed header', () => {
    for (const header of [
      undefined,
      '',
      'secret',
      'Bearer',
      'Bearer wrong',
      'bearer secret',
      'Basic secret',
    ]) {
      assert.equal(isBearerAuthorized(header, 'secret'), false, String(header));
    }
  });

  it('refuses an empty token even when one is expected', () => {
    assert.equal(isBearerAuthorized('Bearer ', 'secret'), false);
  });

  it('refuses everything when no token is expected', () => {
    // A server with no token configured must be unreachable rather than open.
    assert.equal(isBearerAuthorized('Bearer ', ''), false);
    assert.equal(isBearerAuthorized(undefined, ''), false);
  });
});
