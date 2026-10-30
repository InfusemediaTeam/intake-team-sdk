import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import {
  CONTRACT_TOOL_NAMES,
  CREATE_TASK_TOOL,
  GET_TEAM_DESCRIPTOR_TOOL,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from '../src/contract/contract.constants';
import { SDK_VERSION } from '../src/generated/contract.generated';
import { createTeamServer } from '../src/team/team-server';
import type { ITeamDefinition, ITeamTool } from '../src/team/team-definition';
import {
  EXAMPLE_DRAFT,
  EXAMPLE_TEAM,
  EXAMPLE_TOOL,
} from './example-team.fixture';
import { MINIMAL, connect, errorOf } from './team-server.fixture';

// The repository root, from packages/js/dist-test/tests.
const ROOT = join(__dirname, '..', '..', '..', '..');

describe('createTeamServer', () => {
  it('publishes the required contract tools, and status only when the team offers it', async () => {
    const minimal = await connect(MINIMAL);
    const full = await connect(EXAMPLE_TEAM);

    const names = async (client: Client) =>
      (await client.listTools()).tools.map((tool) => tool.name).sort();

    assert.deepEqual(
      await names(minimal),
      [
        CREATE_TASK_TOOL,
        GET_TEAM_DESCRIPTOR_TOOL,
        RENDER_TICKET_TOOL,
        VALIDATE_DEFINITION_OF_READY_TOOL,
      ].sort(),
    );
    assert.deepEqual(
      await names(full),
      [...CONTRACT_TOOL_NAMES, 'example_reference'].sort(),
    );

    await minimal.close();
    await full.close();
  });

  it('marks only creation as not read-only, so a host never hands it to a model', async () => {
    const client = await connect(EXAMPLE_TEAM);

    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.equal(
        tool.annotations?.readOnlyHint,
        tool.name !== CREATE_TASK_TOOL,
        tool.name,
      );
    }

    await client.close();
  });

  it('publishes an object input schema for every tool and an output schema for every contract tool', async () => {
    const client = await connect(EXAMPLE_TEAM);

    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object', tool.name);
      assert.equal(
        tool.outputSchema?.type === 'object',
        CONTRACT_TOOL_NAMES.includes(tool.name),
        tool.name,
      );
    }

    await client.close();
  });

  it('names the server after the team', async () => {
    const client = await connect(EXAMPLE_TEAM);

    assert.equal(client.getServerVersion()?.name, 'intake-example');

    await client.close();
  });

  it('reports the package.json version, which both SDKs are generated from', async () => {
    const client = await connect(EXAMPLE_TEAM);
    const { version } = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf8'),
    ) as { version: string };

    assert.equal(client.getServerVersion()?.version, version);
    assert.equal(SDK_VERSION, version);

    await client.close();
  });

  describe('dispatch', () => {
    it('returns the descriptor as structured content, with the same JSON as text', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: GET_TEAM_DESCRIPTOR_TOOL,
        arguments: {},
      });
      const [block] = result.content as { type: string; text: string }[];

      assert.equal(
        (result.structuredContent as { team: { key: string } }).team.key,
        'EXAMPLE',
      );
      assert.deepEqual(JSON.parse(block.text), result.structuredContent);
      assert.equal('jira' in (result.structuredContent as object), false);

      await client.close();
    });

    it('routes a draft to the readiness check', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: VALIDATE_DEFINITION_OF_READY_TOOL,
        arguments: { draft: EXAMPLE_DRAFT },
      });
      const verdict = result.structuredContent as {
        ready: boolean;
        blockers: { field?: string }[];
      };

      assert.equal(verdict.ready, false);
      assert.ok(
        verdict.blockers.some((issue) => issue.field === 'exampleField'),
      );

      await client.close();
    });

    it('routes a draft to the renderer', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: RENDER_TICKET_TOOL,
        arguments: { draft: EXAMPLE_DRAFT },
      });

      assert.match(
        (result.structuredContent as { description: string }).description,
        /^## /,
      );

      await client.close();
    });

    it("routes to a team's own tool", async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: 'example_reference',
        arguments: {},
      });
      const [block] = result.content as { text: string }[];

      assert.match(block.text, /reference text/);

      await client.close();
    });

    it('reports an unknown tool as a contract error rather than an empty answer', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: 'no_such_tool',
        arguments: {},
      });

      assert.equal(result.isError, true);
      assert.equal(errorOf(result).code, 'INVALID_INPUT');

      await client.close();
    });

    it('does not throw on a malformed draft', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: VALIDATE_DEFINITION_OF_READY_TOOL,
        arguments: { draft: 'not an object' },
      });

      assert.equal(
        (result.structuredContent as { ready: boolean }).ready,
        false,
      );

      await client.close();
    });
  });

  describe('tool name validation', () => {
    const withTools = (tools: readonly ITeamTool[]): ITeamDefinition => ({
      ...EXAMPLE_TEAM,
      tools,
    });

    const named = (name: string): ITeamTool => ({ ...EXAMPLE_TOOL, name });

    for (const reserved of [...CONTRACT_TOOL_NAMES, 'intake_future_tool']) {
      it(`refuses a team tool named ${reserved}`, () => {
        assert.throws(() => createTeamServer(withTools([named(reserved)])), {
          message: /reserves/i,
        });
      });
    }

    it('refuses two team tools sharing a name', () => {
      assert.throws(
        () =>
          createTeamServer(withTools([named('duplicate'), named('duplicate')])),
        { message: /declared more than once/i },
      );
    });

    it('accepts distinct team names that are not reserved', () => {
      assert.doesNotThrow(() =>
        createTeamServer(withTools([named('one'), named('two')])),
      );
    });
  });
});
