import { timingSafeEqual } from 'node:crypto';

/** The scheme a caller presents its token with. */
const BEARER_PREFIX = 'Bearer ';

/**
 * Whether a request carries the expected bearer token.
 *
 * Case-sensitive on the scheme and exact on the token; a blank token never
 * matches, so a server started without one cannot be reached by omitting it.
 *
 * The comparison is constant-time for equal-length values, so a caller cannot
 * learn the token a character at a time from how long the check takes.
 */
export function isBearerAuthorized(
  header: string | undefined,
  expectedToken: string,
): boolean {
  const expected = expectedToken.trim();

  if (expected.length === 0) return false;

  if (!header?.startsWith(BEARER_PREFIX)) return false;

  return equals(header.slice(BEARER_PREFIX.length).trim(), expected);
}

/**
 * `timingSafeEqual` needs equal lengths, so a mismatch short-circuits.
 *
 * That leaks the token's length and nothing else, which is not the secret.
 */
function equals(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, 'utf8');
  const right = Buffer.from(expected, 'utf8');

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}
