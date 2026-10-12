/**
 * What a Jira field value may be, as the contract carries it.
 */

/** Any JSON value, which is everything the wire — and Jira's REST API — reads. */
export type JiraJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JiraJsonValue[]
  | { readonly [key: string]: JiraJsonValue };

/**
 * One Jira field's value: a string, a number, an option such as
 * `{ value: 'Ops' }`, a list of them, a user as `{ accountId }`, an ADF
 * document — whatever that field's schema on the board takes.
 *
 * Deliberately any JSON rather than a union of Jira shapes: which shape is valid
 * depends on how the field is configured on each instance, and only Jira can
 * judge that. A bare `null` is excluded because an unset field is an absent key.
 */
export type JiraFieldValue = Exclude<JiraJsonValue, null>;
