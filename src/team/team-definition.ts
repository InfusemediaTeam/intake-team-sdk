import type {
  IDefinitionOfReadyVerdict,
  IIntakeDraft,
  IRenderedTicket,
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
  execute(args: Readonly<Record<string, unknown>>): string;
}

/**
 * Everything one team owns.
 *
 * A team is data plus two pure functions: this is the whole extension point,
 * and it is why adding a department touches no host code.
 *
 * `validate` and `render` are expected to be fast and free of network calls of
 * their own — a host bounds every call it makes and treats an overrun as the
 * server being unhealthy.
 */
export interface ITeamDefinition {
  readonly descriptor: ITeamDescriptor;
  validate(draft: IIntakeDraft): IDefinitionOfReadyVerdict;
  render(draft: IIntakeDraft): IRenderedTicket;
  readonly tools?: readonly ITeamTool[];
}
