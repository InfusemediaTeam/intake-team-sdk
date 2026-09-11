import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Server as HttpServer } from 'node:http';

import { GET_TEAM_DESCRIPTOR_TOOL } from '../src/contract/contract.constants';
import { runHttpTeamServer } from '../src/transport/http';
import { EXAMPLE_TEAM } from './example-team.fixture';

const TOKEN = 'test-token';

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

const signalListenerCount = (): number =>
  SIGNALS.reduce((total, signal) => total + process.listenerCount(signal), 0);

/**
 * The HTTP path end to end: a real listener, a real MCP client over streamable
 * HTTP, and the bearer check in front of both.
 *
 * Port 0 so the suite never collides with something already listening.
 */
describe('runHttpTeamServer', () => {
  let listener: HttpServer;
  let baseUrl: string;

  before(() => {
    listener = runHttpTeamServer(EXAMPLE_TEAM, { port: 0, authToken: TOKEN });
    const { port } = listener.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => listener.close());

  it('refuses to start without a token', () => {
    assert.throws(
      () => runHttpTeamServer(EXAMPLE_TEAM, { port: 0, authToken: '  ' }),
      {
        message: /auth token is required/i,
      },
    );
  });

  it('installs no process signal handlers by default', () => {
    // A library that registers these takes a decision that is the caller's: an
    // embedding application has its own shutdown order, and a handler installed
    // here would run beside it rather than within it.
    const baseline = signalListenerCount();
    const server = runHttpTeamServer(EXAMPLE_TEAM, {
      port: 0,
      authToken: TOKEN,
    });

    assert.equal(signalListenerCount(), baseline);

    server.close();
  });

  it('closes the listener on a signal only when the caller opts in', () => {
    const baseline = signalListenerCount();
    const server = runHttpTeamServer(EXAMPLE_TEAM, {
      port: 0,
      authToken: TOKEN,
      handleSignals: true,
    });

    assert.equal(signalListenerCount(), baseline + SIGNALS.length);

    for (const signal of SIGNALS) process.emit(signal, signal);

    // Registered with `once`, so nothing is left behind for the rest of the
    // suite, and the process is not ended on the caller's behalf.
    assert.equal(signalListenerCount(), baseline);
    assert.equal(server.listening, false);
  });

  it('answers a health check with the team it serves', async () => {
    const response = await fetch(`${baseUrl}/health`);

    assert.deepEqual(await response.json(), { status: 'ok', team: 'EXAMPLE' });
  });

  it('serves the contract over streamable HTTP to an authorised client', async () => {
    const client = new Client({ name: 'test', version: '1.0.0' });

    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
      }),
    );

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

  it('refuses an unauthorised call with a JSON-RPC error, not an HTML page', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    });
  });
});
