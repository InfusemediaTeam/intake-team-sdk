import { assertContractOutput } from '../contract/contract-output';
import { TaskError } from '../task/task-error';

const INTERNAL_MESSAGE = 'The department could not complete the request.';

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * A contract result, sent both ways.
 *
 * `structuredContent` is what a host reads; the JSON text alongside it keeps
 * the result legible to any MCP client that only understands content blocks.
 *
 * @throws If the payload does not match the tool's published output schema:
 * the host's client would reject it, so it is the team's bug, reported as
 * `INTERNAL` like any other.
 */
export function structured(tool: string, payload: object): ToolResult {
  assertContractOutput(tool, payload);

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

/**
 * The contract's error result: the JSON of `ToolError` as text, and no
 * `structuredContent`, which a client would validate against the success
 * schema. An unexpected error is logged here and reported generically, so
 * nothing internal reaches the requester.
 */
export function failure(
  server: string,
  tool: string,
  error: unknown,
): ToolResult {
  const body =
    error instanceof TaskError
      ? error.toBody()
      : {
          code: 'INTERNAL' as const,
          message: INTERNAL_MESSAGE,
          retryable: true,
        };

  if (!(error instanceof TaskError)) {
    process.stderr.write(
      `${server} ${tool} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: body }) }],
  };
}
