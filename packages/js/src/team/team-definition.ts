import type { IServiceCaller } from '../auth/service-token';
import type {
  ICreateTaskInput,
  ICreateTaskResult,
  IDefinitionOfReadyVerdict,
  IIntakeDraft,
  IRenderedTicket,
  ITaskStatusResult,
  ITeamDescriptor,
} from '../contract/contract.types';

/** JSON Schema for a model-facing tool's arguments, as `tools/list` publishes it. */
export interface IToolInputSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, Record<string, unknown>>>;
  readonly required?: readonly string[];
}

/**
 * An extra tool a team offers the host's assistant.
 *
 * `readOnly` is the safety gate a host is expected to enforce: it adapts a team
 * tool into the assistant's toolset only when the tool declares itself
 * read-only, so a team cannot hand the model something that changes state
 * behind the host's back.
 */
export interface ITeamTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: IToolInputSchema;
  readonly readOnly: boolean;
  execute(args: Readonly<Record<string, unknown>>): string | Promise<string>;
}

/** What a task handler knows about the call beyond its arguments. */
export interface ITaskCallContext {
  /**
   * The verified service token's caller over HTTP; `null` over stdio, where
   * the host that spawned the process is the only one who can write to it.
   */
  readonly caller: IServiceCaller | null;
  /** Aborted when the host cancels the call or the connection drops. */
  readonly signal: AbortSignal;
}

/**
 * Everything one team owns.
 *
 * `validate` and `render` are fast and free of network calls: a host calls
 * them on every turn of an interview and treats an overrun as the server being
 * unhealthy. `createTask` and `getTaskStatus` are where a team does its own I/O.
 */
export interface ITeamDefinition {
  readonly descriptor: ITeamDescriptor;
  validate(draft: IIntakeDraft): IDefinitionOfReadyVerdict;
  render(draft: IIntakeDraft): IRenderedTicket;
  /**
   * Creates the task for a confirmed, ready draft, wherever this team keeps
   * its work. Only called after `validate` passed and the caller was
   * authorized.
   *
   * Must be idempotent on `input.idempotencyKey`: the host retries with the
   * same key after a timeout or failure, and a second call must return the
   * task the first one created rather than open another. The server also
   * merges concurrent calls with the same key inside one process, but only the
   * team's own storage can recognise a task created before a restart.
   *
   * Throw `TaskError` for a failure the requester should hear about.
   */
  createTask(
    input: ICreateTaskInput,
    context: ITaskCallContext,
  ): Promise<ICreateTaskResult>;
  /**
   * The current state of tasks this team created. Optional: without it the
   * host reports the status as unavailable. An unknown id is left out.
   */
  getTaskStatus?(
    taskIds: readonly string[],
    context: ITaskCallContext,
  ): Promise<ITaskStatusResult>;
  readonly tools?: readonly ITeamTool[];
}
