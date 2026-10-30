import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  ServiceTokenError,
  signServiceToken,
  taskIdsDigest,
  verifyServiceToken,
} from '../src/auth/service-token';
import type { IServiceCaller } from '../src/auth/service-token';

/**
 * How to build one token: the base header and claims with these changes, then
 * signed as described. Unset fields mean "as the base", signed with the test key.
 */
interface ITokenCase {
  readonly name: string;
  readonly valid: boolean;
  readonly caller?: IServiceCaller;
  readonly header?: Record<string, unknown>;
  readonly claims?: Record<string, unknown>;
  readonly omitClaims?: readonly string[];
  readonly signingKey?: string;
  readonly signature?: string;
  readonly signatureOf?: string;
  readonly rawToken?: string;
}

/** The same recipes the Python suite verifies, so both SDKs agree on every one. */
const fixture = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'spec',
      'fixtures',
      'service-tokens.json',
    ),
    'utf8',
  ),
) as {
  testSigningKey: string;
  otherTestSigningKey: string;
  issuer: string;
  audience: string;
  now: number;
  baseHeader: Record<string, unknown>;
  baseClaims: Record<string, unknown>;
  pinnedSignature: { case: string; signature: string };
  cases: ITokenCase[];
  taskIdsDigests: { taskIds: string[]; digest: string }[];
};

const options = {
  secret: fixture.testSigningKey,
  issuer: fixture.issuer,
  audience: fixture.audience,
};

const signingKeys: Record<string, string> = {
  testSigningKey: fixture.testSigningKey,
  otherTestSigningKey: fixture.otherTestSigningKey,
};

// Built with node:crypto alone, never with signServiceToken, so a signing bug
// in the SDK cannot hide itself by producing the tokens it is tested against.
function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function hmacSignature(signingInput: string, key: string): string {
  return createHmac('sha256', key).update(signingInput).digest('base64url');
}

function caseNamed(name: string): ITokenCase {
  const testCase = fixture.cases.find((candidate) => candidate.name === name);
  assert.ok(testCase, `No token case named ${name}`);

  return testCase;
}

function signingInputOf(testCase: ITokenCase): string {
  const header = { ...fixture.baseHeader, ...testCase.header };
  const claims = { ...fixture.baseClaims, ...testCase.claims };

  for (const name of testCase.omitClaims ?? []) {
    assert.ok(name in claims, `No claim ${name} to omit`);
    delete claims[name];
  }

  return `${encodeSegment(header)}.${encodeSegment(claims)}`;
}

function buildToken(testCase: ITokenCase): string {
  if (testCase.rawToken !== undefined) {
    return testCase.rawToken;
  }

  const signingInput = signingInputOf(testCase);

  if (testCase.signature === 'empty') {
    return `${signingInput}.`;
  }
  if (testCase.signature === 'omitted') {
    return signingInput;
  }
  assert.equal(testCase.signature, undefined, 'Unknown signature kind');

  if (testCase.signatureOf !== undefined) {
    const donor = signingInputOf(caseNamed(testCase.signatureOf));

    return `${signingInput}.${hmacSignature(donor, fixture.testSigningKey)}`;
  }

  const key = signingKeys[testCase.signingKey ?? 'testSigningKey'];
  assert.ok(key, `Unknown signing key ${testCase.signingKey}`);

  return `${signingInput}.${hmacSignature(signingInput, key)}`;
}

describe('verifyServiceToken (shared recipes)', () => {
  for (const testCase of fixture.cases) {
    it(`${testCase.valid ? 'accepts' : 'refuses'} ${testCase.name}`, () => {
      const token = buildToken(testCase);

      if (testCase.valid) {
        assert.deepEqual(
          verifyServiceToken(token, options, fixture.now),
          testCase.caller,
        );
      } else {
        assert.throws(
          () => verifyServiceToken(token, options, fixture.now),
          ServiceTokenError,
        );
      }
    });
  }

  it('builds the pinned signature, byte for byte', () => {
    const { case: name, signature } = fixture.pinnedSignature;

    assert.equal(buildToken(caseNamed(name)).split('.')[2], signature);
  });

  it('never gives a wrong-signature case a signature the test key would make', () => {
    const wronglySigned = fixture.cases.filter(
      (testCase) =>
        testCase.signatureOf !== undefined ||
        (testCase.signingKey ?? 'testSigningKey') !== 'testSigningKey',
    );
    assert.ok(wronglySigned.length > 0);

    for (const testCase of wronglySigned) {
      const signingInput = signingInputOf(testCase);

      assert.notEqual(
        buildToken(testCase),
        `${signingInput}.${hmacSignature(signingInput, fixture.testSigningKey)}`,
        testCase.name,
      );
    }
  });
});

describe('taskIdsDigest (shared vectors)', () => {
  for (const { taskIds, digest } of fixture.taskIdsDigests) {
    it(`hashes ${JSON.stringify(taskIds)} as the Python SDK does`, () => {
      assert.equal(taskIdsDigest(taskIds), digest);
    });
  }
});

describe('signServiceToken', () => {
  it('binds the task ids it is given, and nothing when given none', () => {
    const request = {
      ...options,
      scopes: ['intake:read'],
      subject: 'user-9',
      lifetimeSeconds: 60,
    };

    assert.equal(
      verifyServiceToken(
        signServiceToken({ ...request, taskIds: ['PROJ-1', 'PROJ-2'] }),
        options,
      ).taskIdsDigest,
      taskIdsDigest(['PROJ-1', 'PROJ-2']),
    );
    assert.equal(
      verifyServiceToken(signServiceToken(request), options).taskIdsDigest,
      null,
    );
  });

  it('signs a token verifyServiceToken accepts', () => {
    const token = signServiceToken({
      ...options,
      scopes: ['intake:read', 'intake:create'],
      subject: 'user-9',
      lifetimeSeconds: 60,
    });

    const caller = verifyServiceToken(token, options);

    assert.equal(caller.subject, 'user-9');
    assert.deepEqual(caller.scopes, ['intake:read', 'intake:create']);
  });

  it('gives every token its own id', () => {
    const request = {
      ...options,
      scopes: ['intake:read'],
      lifetimeSeconds: 60,
    };

    assert.notEqual(
      verifyServiceToken(signServiceToken(request), options).tokenId,
      verifyServiceToken(signServiceToken(request), options).tokenId,
    );
  });

  it('refuses a short secret', () => {
    assert.throws(
      () =>
        signServiceToken({
          ...options,
          secret: 'short',
          scopes: [],
          lifetimeSeconds: 60,
        }),
      /at least 32 characters/,
    );
  });

  it('refuses a lifetime over the contract maximum', () => {
    assert.throws(
      () => signServiceToken({ ...options, scopes: [], lifetimeSeconds: 301 }),
      /between 1 and 300 seconds/,
    );
  });
});
