import type { IToolErrorBody, ToolErrorCode } from '../contract/contract.types';

/**
 * A failure a department reports on purpose, e.g. its board refusing the task.
 *
 * Thrown from `createTask` or `getTaskStatus`; the server turns it into the
 * contract's error result. The message reaches the requester, so it must not
 * carry credentials, stack traces or an upstream payload. Anything else thrown
 * is reported as `INTERNAL` with a generic message.
 */
export class TaskError extends Error {
  public constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'TaskError';
  }

  public toBody(): IToolErrorBody {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}
