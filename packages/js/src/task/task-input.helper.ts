import type {
  ICreateTaskInput,
  ITaskReference,
  ITaskStatus,
  ITaskStatusResult,
} from '../contract/contract.types';
import { isTaskReference, isTaskStatus } from '../contract/contract-output';
import { toIntakeDraft } from '../draft/draft.helper';
import { TaskError } from './task-error';

/** Mirrors `CreateTaskInput.idempotencyKey` in `spec/`. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

const MAX_USER_ID_LENGTH = 128;

const MAX_TASK_IDS = 50;

const MAX_TASK_ID_LENGTH = 256;

/**
 * Reads `intake_create_task` arguments.
 *
 * Strict where a draft is lenient: a draft that cannot be read only fails
 * readiness, but a task created without a stable key or a requester cannot be
 * deduplicated or attributed, so either one refuses the call.
 *
 * @throws TaskError `INVALID_INPUT`.
 */
export function toCreateTaskInput(args: unknown): ICreateTaskInput {
  const source = isRecord(args) ? args : {};
  const requester = isRecord(source.requester) ? source.requester : {};
  const { idempotencyKey } = source;
  const { userId, email } = requester;

  if (
    typeof idempotencyKey !== 'string' ||
    !IDEMPOTENCY_KEY.test(idempotencyKey)
  ) {
    throw new TaskError(
      'INVALID_INPUT',
      'idempotencyKey is missing or malformed',
    );
  }

  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    userId.length > MAX_USER_ID_LENGTH
  ) {
    throw new TaskError(
      'INVALID_INPUT',
      'requester.userId is missing or malformed',
    );
  }

  if (email !== null && typeof email !== 'string') {
    throw new TaskError(
      'INVALID_INPUT',
      'requester.email must be a string or null',
    );
  }

  return {
    idempotencyKey,
    draft: toIntakeDraft(source),
    requester: { userId, email },
  };
}

/** @throws TaskError `INVALID_INPUT`. */
export function toTaskIds(args: unknown): readonly string[] {
  const taskIds = isRecord(args) ? args.taskIds : undefined;

  if (
    !Array.isArray(taskIds) ||
    taskIds.length === 0 ||
    taskIds.length > MAX_TASK_IDS ||
    !taskIds.every(
      (id) =>
        typeof id === 'string' &&
        id.length > 0 &&
        id.length <= MAX_TASK_ID_LENGTH,
    )
  ) {
    throw new TaskError(
      'INVALID_INPUT',
      `taskIds must list 1 to ${MAX_TASK_IDS} task ids`,
    );
  }

  return taskIds as string[];
}

/**
 * A department's own task reference, checked before it leaves the server.
 *
 * Held to the output schema, and its `id` and `displayKey` must not be blank.
 * A malformed one is the department's bug, so it is reported as `INTERNAL`
 * here rather than as a schema failure inside the host.
 */
export function checkedTaskReference(task: ITaskReference): ITaskReference {
  if (
    !isTaskReference(task) ||
    !nonBlank(task.id) ||
    !nonBlank(task.displayKey)
  ) {
    throw new TaskError(
      'INTERNAL',
      'The department returned a malformed task reference',
    );
  }

  return {
    id: task.id,
    displayKey: task.displayKey,
    url: task.url,
    location: task.location,
  };
}

/**
 * Only statuses for the ids asked about, each held to the output schema with a
 * label that is not blank; the rest are dropped.
 */
export function checkedStatuses(
  result: ITaskStatusResult,
  taskIds: readonly string[],
): ITaskStatusResult {
  const asked = new Set(taskIds);
  const statuses = (
    Array.isArray(result?.statuses) ? result.statuses : []
  ).filter(
    (status: ITaskStatus) =>
      isTaskStatus(status) &&
      asked.has(status.taskId) &&
      nonBlank(status.label),
  );

  return { statuses };
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
