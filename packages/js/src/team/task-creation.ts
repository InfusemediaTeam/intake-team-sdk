import type {
  ICreateTaskInput,
  ICreateTaskResult,
} from '../contract/contract.types';
import { TaskError } from '../task/task-error';
import { checkedTaskReference } from '../task/task-input.helper';
import type { ITaskCallContext, ITeamDefinition } from './team-definition';

/**
 * How one creation in flight ended, as every call that joined it sees it.
 * `abandoned` means the call that owned it was aborted before the team
 * answered, so nothing is known about the task.
 */
type FlightOutcome =
  | { readonly kind: 'created'; readonly result: ICreateTaskResult }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'abandoned'; readonly error: unknown };

/**
 * Creations in flight per team and key, shared by every server built for the
 * same definition: the HTTP transport builds a fresh server per request, and
 * two concurrent retries must still meet here.
 */
const inFlight = new WeakMap<
  ITeamDefinition,
  Map<string, Promise<FlightOutcome>>
>();

/**
 * The generic gates in front of a team's own `createTask`.
 *
 * The requester must be the token's subject, so a host cannot be tricked into
 * filing a task under someone else by whatever wrote the arguments. The draft
 * must pass the team's own readiness check again: confirmation at the host is
 * a claim about the draft, and this is where it is checked.
 *
 * Concurrent calls are merged by `idempotencyKey` alone, the contract's
 * identifier for one creation request, as the team's own storage recognises it.
 */
export async function createTask(
  definition: ITeamDefinition,
  input: ICreateTaskInput,
  context: ITaskCallContext,
): Promise<ICreateTaskResult> {
  if (context.caller && context.caller.subject !== input.requester.userId) {
    throw new TaskError(
      'FORBIDDEN',
      'The requester does not match the authenticated caller',
    );
  }

  const verdict = definition.validate(input.draft);

  if (!verdict.ready) {
    throw new TaskError(
      'NOT_READY',
      'The draft does not meet the Definition of Ready',
    );
  }

  const pending = inFlightFor(definition);
  const key = input.idempotencyKey;

  for (
    let running = pending.get(key);
    running !== undefined;
    running = pending.get(key)
  ) {
    const outcome = await running;

    if (outcome.kind === 'created') return outcome.result;

    if (outcome.kind === 'failed') throw outcome.error;

    // The call that owned the creation was aborted before it settled, so
    // nothing is known about the task; this call takes the creation over,
    // unless it was aborted too.
    context.signal.throwIfAborted();
  }

  let settle!: (outcome: FlightOutcome) => void;
  const flight = new Promise<FlightOutcome>((resolve) => {
    settle = resolve;
  });

  pending.set(key, flight);

  const outcome = await attemptCreation(definition, input, context);

  // Removed before the waiters resume, so the first of them to find no
  // creation in flight is the one that starts the next.
  if (pending.get(key) === flight) pending.delete(key);

  settle(outcome);

  if (outcome.kind === 'created') return outcome.result;

  throw outcome.error;
}

/** The team's own creation, settled into an outcome rather than a rejection. */
async function attemptCreation(
  definition: ITeamDefinition,
  input: ICreateTaskInput,
  context: ITaskCallContext,
): Promise<FlightOutcome> {
  try {
    const result = await definition.createTask(input, context);

    return {
      kind: 'created',
      result: { task: checkedTaskReference(result.task) },
    };
  } catch (error) {
    return {
      kind: context.signal.aborted ? 'abandoned' : 'failed',
      error,
    };
  }
}

function inFlightFor(
  definition: ITeamDefinition,
): Map<string, Promise<FlightOutcome>> {
  let pending = inFlight.get(definition);

  if (!pending) {
    pending = new Map();
    inFlight.set(definition, pending);
  }

  return pending;
}
