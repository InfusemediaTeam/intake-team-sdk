/**
 * The wire contract between an intake host and a team MCP server.
 *
 * Version it, because a host refuses a descriptor whose major version it does
 * not understand: a team that ships a breaking change must say so rather than
 * have the host guess at a shape it cannot read.
 */
export const INTAKE_CONTRACT_VERSION = '1.0';

/**
 * The three tools the host calls itself.
 *
 * Reserved names, and deliberately not model-facing: a model must not be able
 * to invoke its own readiness check or render its own ticket body, or the gate
 * stops being a gate.
 */
export const GET_TEAM_DESCRIPTOR_TOOL = 'intake_get_team_descriptor';

export const VALIDATE_DEFINITION_OF_READY_TOOL =
  'intake_validate_definition_of_ready';

export const RENDER_TICKET_TOOL = 'intake_render_ticket';

export const CONTRACT_TOOL_NAMES: readonly string[] = [
  GET_TEAM_DESCRIPTOR_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
  RENDER_TICKET_TOOL,
];
