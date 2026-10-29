import type {
  IDefinitionOfReadyVerdict,
  IIntakeCoreFields,
  IIntakeDraft,
  IReadinessIssue,
} from '../contract/contract.types';
import { fieldValue, filled } from '../draft/draft.helper';

/** The two messages an enum check can produce. */
export interface IEnumFieldMessages {
  /** Shown when the field is absent or blank. */
  readonly missing: string;
  /** Shown when a value was given that the team does not define. */
  readonly invalid: (value: string) => string;
}

/**
 * Collects a Definition of Ready verdict for one draft.
 *
 * The rules are the team's; the bookkeeping — two lists, order preserved,
 * `ready` derived from the blockers — is not, and every team was writing it
 * out by hand. Every message is supplied by the caller, in the team's own
 * words, because a blocker is what the requester is asked for.
 *
 * Chainable, and the order of the calls is the order the issues are reported
 * in.
 */
export class ReadinessReport {
  private readonly blockers: IReadinessIssue[] = [];

  private readonly warnings: IReadinessIssue[] = [];

  constructor(private readonly draft: IIntakeDraft) {}

  /** An unconditional blocker, for a rule that has no helper here. */
  block(field: string | undefined, message: string): this {
    this.blockers.push(field === undefined ? { message } : { field, message });

    return this;
  }

  /** Worth having, never blocking. */
  warn(field: string | undefined, message: string): this {
    this.warnings.push(field === undefined ? { message } : { field, message });

    return this;
  }

  /** A blocker only when the team's own condition holds. */
  blockWhen(condition: boolean, field: string, message: string): this {
    return condition ? this.block(field, message) : this;
  }

  /** One of the host's core fields must be filled in. */
  requireCore(key: keyof IIntakeCoreFields, message: string): this {
    return this.blockWhen(!filled(this.draft.core[key]), key, message);
  }

  /** One of the team's own fields must be filled in. */
  requireField(key: string, message: string): this {
    return this.blockWhen(fieldValue(this.draft, key) === null, key, message);
  }

  /**
   * One of the team's own fields must hold a value the team defines.
   *
   * Absent and unrecognised are separate messages because they ask the
   * requester for different things: one to answer, one to correct.
   */
  requireEnumField(
    key: string,
    options: readonly string[],
    messages: IEnumFieldMessages,
  ): this {
    const value = fieldValue(this.draft, key);

    if (value === null) return this.block(key, messages.missing);

    return this.blockWhen(
      !options.includes(value),
      key,
      messages.invalid(value),
    );
  }

  /** A field whose absence is worth mentioning but must not block. */
  warnMissingField(key: string, message: string): this {
    if (fieldValue(this.draft, key) !== null) return this;

    return this.warn(key, message);
  }

  verdict(): IDefinitionOfReadyVerdict {
    return {
      ready: this.blockers.length === 0,
      blockers: this.blockers,
      warnings: this.warnings,
    };
  }
}

/** Starts a {@link ReadinessReport} for one draft. */
export function readiness(draft: IIntakeDraft): ReadinessReport {
  return new ReadinessReport(draft);
}
