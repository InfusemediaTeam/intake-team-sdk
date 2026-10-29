import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import type { IServiceTokenClaims } from '../contract/contract.types';
import { SERVICE_TOKEN_RULES } from '../generated/contract.generated';

/**
 * Short-lived HS256 tokens a host sends a department server over HTTP.
 *
 * HS256 with one secret per department: a department can verify only tokens
 * meant for it, and neither side needs a JWT library. The checks are the
 * contract's, in `spec/contract.json`, so the Python SDK applies the same ones.
 */

const MILLISECONDS_PER_SECOND = 1000;

const HEADER = { alg: SERVICE_TOKEN_RULES.algorithm, typ: 'JWT' } as const;

/** A base64url SHA-256 digest: 32 bytes, unpadded. */
const TASK_IDS_DIGEST = /^[A-Za-z0-9_-]{43}$/;

/** What a server needs to accept a token. */
export interface IServiceTokenOptions {
  /** At least 32 characters, shared with the host for this department only. */
  readonly secret: string;
  /** The host's name, e.g. `example-host`. */
  readonly issuer: string;
  /** This server's own name, as the host addresses it. */
  readonly audience: string;
}

/** A verified caller, as a tool handler sees it. */
export interface IServiceCaller {
  readonly issuer: string;
  /** The requester's `userId`, when the host is acting for one. */
  readonly subject: string | null;
  /**
   * The task ids the host found owned by `subject`, as {@link taskIdsDigest}
   * of the exact list it sends; `null` when the token covers no status read.
   */
  readonly taskIdsDigest: string | null;
  readonly scopes: readonly string[];
  readonly tokenId: string;
  /** Epoch seconds. */
  readonly expiresAt: number;
}

/** What a host puts into a token, beyond the fields this fills in. */
export interface IServiceTokenRequest {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly scopes: readonly string[];
  readonly subject?: string;
  /** The exact `taskIds` a status call sends, already checked owned by `subject`. */
  readonly taskIds?: readonly string[];
  readonly lifetimeSeconds: number;
}

/** A token the server refuses. The message is safe to log, never the token. */
export class ServiceTokenError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ServiceTokenError';
  }
}

/** @throws If the secret is shorter than the contract allows. */
export function assertServiceSecret(secret: string): void {
  if (secret.length < SERVICE_TOKEN_RULES.minSecretLength) {
    throw new Error(
      `A service token secret must be at least ${SERVICE_TOKEN_RULES.minSecretLength} characters`,
    );
  }
}

/**
 * Signs one token. For hosts and tests; a department server only verifies.
 *
 * @param now Epoch milliseconds, injectable so a test can pin the clock.
 */
export function signServiceToken(
  request: IServiceTokenRequest,
  now: number = Date.now(),
): string {
  assertServiceSecret(request.secret);

  if (
    request.lifetimeSeconds <= 0 ||
    request.lifetimeSeconds > SERVICE_TOKEN_RULES.maxLifetimeSeconds
  ) {
    throw new Error(
      `A service token lives between 1 and ${SERVICE_TOKEN_RULES.maxLifetimeSeconds} seconds`,
    );
  }

  const issuedAt = Math.floor(now / MILLISECONDS_PER_SECOND);
  const claims: IServiceTokenClaims = {
    iss: request.issuer,
    aud: request.audience,
    ...(request.subject === undefined ? {} : { sub: request.subject }),
    ...(request.taskIds === undefined
      ? {}
      : { task_ids_sha256: taskIdsDigest(request.taskIds) }),
    scope: request.scopes.join(' '),
    iat: issuedAt,
    exp: issuedAt + request.lifetimeSeconds,
    jti: randomUUID(),
  };

  const signingInput = `${encode(HEADER)}.${encode(claims)}`;

  return `${signingInput}.${signature(signingInput, request.secret)}`;
}

/**
 * The caller a token proves, or a `ServiceTokenError`.
 *
 * Checked: the HS256 signature, issuer, audience, expiry and issue time with
 * the contract's clock tolerance, and a lifetime no longer than the contract's
 * maximum, so a leaked long-lived token is refused even when correctly signed.
 *
 * @param now Epoch milliseconds, injectable so a test can pin the clock.
 */
export function verifyServiceToken(
  token: string,
  options: IServiceTokenOptions,
  now: number = Date.now(),
): IServiceCaller {
  const parts = token.split('.');

  if (parts.length !== 3) throw new ServiceTokenError('Malformed token');

  const [encodedHeader, encodedClaims, presented] = parts;
  const header = decode(encodedHeader);

  // Pinned rather than read from the token: trusting its own `alg` is how
  // `none` and algorithm-confusion attacks get in.
  if (header.alg !== HEADER.alg) {
    throw new ServiceTokenError('Unsupported token algorithm');
  }

  const expected = signature(
    `${encodedHeader}.${encodedClaims}`,
    options.secret,
  );

  if (!sameText(presented, expected)) {
    throw new ServiceTokenError('Invalid token signature');
  }

  const claims = decode(encodedClaims);
  const seconds = Math.floor(now / MILLISECONDS_PER_SECOND);
  const tolerance = SERVICE_TOKEN_RULES.clockToleranceSeconds;

  if (claims.iss !== options.issuer) {
    throw new ServiceTokenError('Unexpected token issuer');
  }

  if (claims.aud !== options.audience) {
    throw new ServiceTokenError('Unexpected token audience');
  }

  const issuedAt = integer(claims.iat, 'iat');
  const expiresAt = integer(claims.exp, 'exp');

  if (expiresAt + tolerance <= seconds) {
    throw new ServiceTokenError('Token expired');
  }

  if (issuedAt - tolerance > seconds) {
    throw new ServiceTokenError('Token issued in the future');
  }

  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > SERVICE_TOKEN_RULES.maxLifetimeSeconds
  ) {
    throw new ServiceTokenError('Token lifetime out of range');
  }

  if (typeof claims.jti !== 'string' || claims.jti.length === 0) {
    throw new ServiceTokenError('Token has no id');
  }

  if (typeof claims.scope !== 'string') {
    throw new ServiceTokenError('Token has no scope');
  }

  if (
    claims.sub !== undefined &&
    (typeof claims.sub !== 'string' || claims.sub.length === 0)
  ) {
    throw new ServiceTokenError('Malformed token subject');
  }

  const digest = claims.task_ids_sha256;

  if (
    digest !== undefined &&
    (typeof digest !== 'string' || !TASK_IDS_DIGEST.test(digest))
  ) {
    throw new ServiceTokenError('Malformed token task binding');
  }

  return {
    issuer: options.issuer,
    subject: typeof claims.sub === 'string' ? claims.sub : null,
    taskIdsDigest: typeof digest === 'string' ? digest : null,
    scopes: claims.scope.split(' ').filter((scope) => scope.length > 0),
    tokenId: claims.jti,
    expiresAt,
  };
}

/**
 * What `task_ids_sha256` binds: the base64url SHA-256 of `taskIds` as compact
 * JSON, in the order sent. A status call is answered only when its own
 * `taskIds` hash to the token's, so a token reads exactly the tasks the host
 * checked against its own records, and never an id added later.
 */
export function taskIdsDigest(taskIds: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify(taskIds), 'utf8')
    .digest('base64url');
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(segment: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new ServiceTokenError('Malformed token');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ServiceTokenError('Malformed token');
  }

  return parsed as Record<string, unknown>;
}

function signature(signingInput: string, secret: string): string {
  return createHmac('sha256', secret).update(signingInput).digest('base64url');
}

function integer(value: unknown, claim: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ServiceTokenError(`Token ${claim} must be an integer`);
  }

  return value;
}

/** Constant-time for equal lengths; a length mismatch reveals nothing secret. */
function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}
