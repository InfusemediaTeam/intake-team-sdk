import {
  CONTRACT_VERSION,
  RESERVED_TOOL_PREFIX,
  SCOPES,
} from '../generated/contract.generated';

/**
 * The wire contract between an intake host and a team MCP server.
 *
 * Versioned, because a host refuses a descriptor whose major version it does
 * not understand: a team that ships a breaking change must say so rather than
 * have the host guess at a shape it cannot read. Defined in `spec/`.
 */
export const INTAKE_CONTRACT_VERSION = CONTRACT_VERSION;

/**
 * Every tool name starting with this belongs to the contract. A team tool may
 * not use it, so a later contract tool can never collide with one.
 */
export const CONTRACT_TOOL_PREFIX = RESERVED_TOOL_PREFIX;

/**
 * The contract tools, called by the host only and never exposed to a model:
 * a model must not be able to pass its own readiness check, render its own
 * ticket or create a task.
 */
export const GET_TEAM_DESCRIPTOR_TOOL = 'intake_get_team_descriptor';

export const VALIDATE_DEFINITION_OF_READY_TOOL =
  'intake_validate_definition_of_ready';

export const RENDER_TICKET_TOOL = 'intake_render_ticket';

export const CREATE_TASK_TOOL = 'intake_create_task';

export const GET_TASK_STATUS_TOOL = 'intake_get_task_status';

export const CONTRACT_TOOL_NAMES: readonly string[] = [
  GET_TEAM_DESCRIPTOR_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
  RENDER_TICKET_TOOL,
  CREATE_TASK_TOOL,
  GET_TASK_STATUS_TOOL,
];

/** Granted by a service token; `intake:create` is needed only for creation. */
export const READ_SCOPE = SCOPES.read;

export const CREATE_SCOPE = SCOPES.create;
