import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types.js';

import { TOOL_CONTRACTS } from '../generated/contract.generated';
import { CREATE_TASK_TOOL, GET_TASK_STATUS_TOOL } from './contract.constants';

/**
 * The validator an MCP client runs on `structuredContent`, against the output
 * schemas `tools/list` publishes. A team's output is judged here as the host's
 * client will judge it, so what that client would reject never leaves.
 */
const validator = new AjvJsonSchemaValidator();

const outputChecks = new Map(
  TOOL_CONTRACTS.map((tool) => [
    tool.name,
    validator.getValidator(tool.outputSchema as JsonSchemaType),
  ]),
);

/** One task reference as `intake_create_task`'s output schema defines it. */
export const isTaskReference = definitionCheck(
  CREATE_TASK_TOOL,
  'TaskReference',
);

/** One status as `intake_get_task_status`'s output schema defines it. */
export const isTaskStatus = definitionCheck(GET_TASK_STATUS_TOOL, 'TaskStatus');

/**
 * @throws If `payload` is not what the contract tool's output schema allows;
 * the message says where, never with the value itself.
 */
export function assertContractOutput(tool: string, payload: unknown): void {
  const result = outputChecks.get(tool)?.(payload);

  if (result && !result.valid) {
    throw new Error(
      `The ${tool} result does not match its output schema: ${result.errorMessage}`,
    );
  }
}

function definitionCheck(
  tool: string,
  definition: string,
): (value: unknown) => boolean {
  const contract = TOOL_CONTRACTS.find((candidate) => candidate.name === tool);

  if (!contract) throw new Error(`No contract tool named ${tool}`);

  const check = validator.getValidator({
    $ref: `#/definitions/${definition}`,
    definitions: contract.outputSchema.definitions,
  } as JsonSchemaType);

  return (value) => check(value).valid;
}
