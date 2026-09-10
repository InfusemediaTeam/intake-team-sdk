import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  GET_TEAM_DESCRIPTOR_TOOL,
  RENDER_TICKET_TOOL,
  VALIDATE_DEFINITION_OF_READY_TOOL,
} from '../src/contract/contract.constants';
import { createTeamServer } from '../src/team/team-server';
import type { ITeamDefinition } from '../src/team/team-definition';
import { EXAMPLE_DRAFT, EXAMPLE_TEAM } from './example-team.fixture';

/** A live client wired to a server over an in-memory pair — no process, no port. */
const connect = async (definition: ITeamDefinition): Promise<Client> => {
  const server = createTeamServer(definition);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });

  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  return client;
};

/** The team stripped of its own tools, so the contract surface stands alone. */
const CONTRACT_ONLY: ITeamDefinition = {
  descriptor: EXAMPLE_TEAM.descriptor,
  validate: (draft) => EXAMPLE_TEAM.validate(draft),
  render: (draft) => EXAMPLE_TEAM.render(draft),
};

/**
 * The wire surface a host integrates against: that the three contract tools are
 * published, that they dispatch to the right function, and that an unknown name
 * is an error rather than a silent empty answer.
 */
describe('createTeamServer', () => {
  it('publishes exactly the three contract tools for a team with none of its own', async () => {
    const client = await connect(CONTRACT_ONLY);

    const { tools } = await client.listTools();

    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        GET_TEAM_DESCRIPTOR_TOOL,
        RENDER_TICKET_TOOL,
        VALIDATE_DEFINITION_OF_READY_TOOL,
      ].sort(),
    );

    await client.close();
  });

  it("publishes a team's own tools alongside them", async () => {
    const client = await connect(EXAMPLE_TEAM);

    const { tools } = await client.listTools();

    assert.ok(tools.some((tool) => tool.name === 'example_reference'));

    await client.close();
  });

  it("reports a team tool's own read-only annotation", async () => {
    // A host refuses to adapt a tool that does not declare itself read-only, so
    // an annotation that went missing here would silently lose the tool.
    const client = await connect(EXAMPLE_TEAM);

    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    }

    await client.close();
  });

  it('publishes an input schema a host can read for every tool', async () => {
    const client = await connect(EXAMPLE_TEAM);

    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object', tool.name);
    }

    await client.close();
  });

  it('names the server after the team', async () => {
    const client = await connect(EXAMPLE_TEAM);

    assert.equal(client.getServerVersion()?.name, 'intake-example');

    await client.close();
  });

  describe('dispatch', () => {
    it('returns the descriptor as structured content', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: GET_TEAM_DESCRIPTOR_TOOL,
        arguments: {},
      });

      assert.equal(
        (result.structuredContent as { team: { key: string } }).team.key,
        'EXAMPLE',
      );

      await client.close();
    });

    it('sends the same payload as JSON text alongside it', async () => {
      // A host prefers `structuredContent`, but the text block is part of the
      // contract too and must not disagree with it.
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: GET_TEAM_DESCRIPTOR_TOOL,
        arguments: {},
      });
      const [block] = result.content as { type: string; text: string }[];

      assert.equal(block.type, 'text');
      assert.deepEqual(JSON.parse(block.text), result.structuredContent);

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

    it('reports an unknown tool as an error rather than an empty answer', async () => {
      const client = await connect(EXAMPLE_TEAM);

      const result = await client.callTool({
        name: 'no_such_tool',
        arguments: {},
      });

      assert.equal(result.isError, true);

      await client.close();
    });

    it('does not throw on a malformed draft', async () => {
      // A host's job is to hear "not ready", not to handle an exception from
      // somebody else's validator.
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
});
