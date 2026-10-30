import type { IServiceCaller } from '../auth/service-token';
import { taskIdsDigest } from '../auth/service-token';
import { CREATE_SCOPE, READ_SCOPE } from '../contract/contract.constants';
import { TOOL_CONTRACTS } from '../generated/contract.generated';
import { TaskError } from '../task/task-error';
import type { ITeamTool } from './team-definition';

/**
 * The scope a call needs, decided on the server rather than left to which
 * tools a host shows a model.
 *
 * A contract tool needs the scope `spec/` declares for it. A team tool that is
 * not read-only needs `intake:create`, the scope that already lets a caller
 * change state, so a token minted only to read never reaches one. A read-only
 * team tool, or a name nothing answers to, needs `intake:read`.
 */
export function requiredScope(
  name: string,
  teamTools: readonly ITeamTool[],
): string {
  const contract = TOOL_CONTRACTS.find((tool) => tool.name === name);

  if (contract) return contract.scope;

  const tool = teamTools.find((candidate) => candidate.name === name);

  return tool && !tool.readOnly ? CREATE_SCOPE : READ_SCOPE;
}

/** @throws TaskError when a token caller lacks the scope. */
export function authorize(caller: IServiceCaller | null, scope: string): void {
  if (caller && !caller.scopes.includes(scope)) {
    throw new TaskError('FORBIDDEN', `This call needs the ${scope} scope`);
  }
}

/**
 * A token caller reads only the tasks its token was issued for.
 *
 * The host is the one that knows whose task is whose: it signs the requester
 * as `sub` and the ids it found owned by them as `task_ids_sha256`. Requiring
 * both, and an exact match on the ids, means a token can never read a task id
 * added to the call after signing, and one issued without a requester — for
 * discovery or a preview — reads none at all.
 *
 * @throws TaskError `FORBIDDEN` otherwise; the reason is not told apart, so a
 * refusal says nothing about whose tasks these are.
 */
export function authorizeStatusRead(
  caller: IServiceCaller | null,
  taskIds: readonly string[],
): void {
  if (!caller) return;

  if (
    caller.subject === null ||
    caller.taskIdsDigest === null ||
    caller.taskIdsDigest !== taskIdsDigest(taskIds)
  ) {
    throw new TaskError('FORBIDDEN', 'This token does not cover these tasks');
  }
}
