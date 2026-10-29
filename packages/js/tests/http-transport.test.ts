import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Server as HttpServer } from 'node:http';

import { signServiceToken } from '../src/auth/service-token';
import {
  CREATE_TASK_TOOL,
  GET_TASK_STATUS_TOOL,
  GET_TEAM_DESCRIPTOR_TOOL,
} from '../src/contract/contract.constants';
import { runHttpTeamServer } from '../src/transport/http';
import { EXAMPLE_TEAM, READY_DRAFT } from './example-team.fixture';

const AUTH = {
  secret: 'http-test-secret-0123456789-abcdefgh',
  issuer: 'test-host',
  audience: 'example',
};

const token = (overrides: Record<string, unknown> = {}): string =>
  signServiceToken({
    ...AUTH,
    scopes: ['intake:read'],
    lifetimeSeconds: 60,
    ...overrides,
  });

const connectWith = async (
  baseUrl: string,
  bearer: string,
): Promise<Client> => {
  const client = new Client({ name: 'test', version: '1.0.0' });

  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    }),
  );

  return client;
};

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

const signalListenerCount = (): number =>
  SIGNALS.reduce((total, signal) => total + process.listenerCount(signal), 0);

/**
 * The HTTP path end to end: a real listener, a real MCP client over streamable
 * HTTP, and the service-token check in front of both.
 *
 * Port 0 so the suite never collides with something already listening.
 */
describe('runHttpTeamServer', () => {
  let listener: HttpServer;
  let baseUrl: string;

  before(() => {
    listener = runHttpTeamServer(EXAMPLE_TEAM, { port: 0, auth: AUTH });
    const { port } = listener.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => listener.close());

  it('refuses to start with a short secret', () => {
    assert.throws(
      () =>
        runHttpTeamServer(EXAMPLE_TEAM, {
          port: 0,
          auth: { ...AUTH, secret: 'short' },
        }),
      { message: /at least 32 characters/i },
    );
  });

  it('refuses to start without an audience', () => {
    assert.throws(
      () =>
        runHttpTeamServer(EXAMPLE_TEAM, {
          port: 0,
          auth: { ...AUTH, audience: ' ' },
        }),
      { message: /issuer and audience are required/i },
    );
  });

  it('installs no process signal handlers by default', () => {
    // A library that registers these takes a decision that is the caller's: an
    // embedding application has its own shutdown order, and a handler installed
    // here would run beside it rather than within it.
    const baseline = signalListenerCount();
    const server = runHttpTeamServer(EXAMPLE_TEAM, {
      port: 0,
      auth: AUTH,
    });

    assert.equal(signalListenerCount(), baseline);

    server.close();
  });

  it('closes the listener on a signal only when the caller opts in', () => {
    const baseline = signalListenerCount();
    const server = runHttpTeamServer(EXAMPLE_TEAM, {
      port: 0,
      auth: AUTH,
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
    const client = await connectWith(baseUrl, token());

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

  it('creates a task for the subject a create-scoped token names', async () => {
    const client = await connectWith(
      baseUrl,
      token({ scopes: ['intake:create'], subject: 'user-1' }),
    );

    const result = await client.callTool({
      name: CREATE_TASK_TOOL,
      arguments: {
        idempotencyKey: 'http-1',
        draft: READY_DRAFT,
        requester: { userId: 'user-1', email: null },
      },
    });

    assert.equal(result.isError, undefined);

    await client.close();
  });

  it('refuses a forged requester even with a valid create token', async () => {
    const client = await connectWith(
      baseUrl,
      token({ scopes: ['intake:create'], subject: 'user-1' }),
    );

    const result = await client.callTool({
      name: CREATE_TASK_TOOL,
      arguments: {
        idempotencyKey: 'http-2',
        draft: READY_DRAFT,
        requester: { userId: 'user-2', email: null },
      },
    });
    const [block] = result.content as { text: string }[];

    assert.equal(result.isError, true);
    assert.match(block.text, /FORBIDDEN/);

    await client.close();
  });

  for (const [label, bound, allowed] of [
    ['the tasks it was issued for', ['task-1'], true],
    ['tasks it was not issued for', ['task-2'], false],
  ] as const) {
    it(`${allowed ? 'reads' : 'refuses'} the status of ${label}`, async () => {
      const client = await connectWith(
        baseUrl,
        token({ subject: 'user-1', taskIds: bound }),
      );

      const result = await client.callTool({
        name: GET_TASK_STATUS_TOOL,
        arguments: { taskIds: ['task-1'] },
      });
      const [block] = result.content as { text: string }[];

      if (allowed) {
        assert.equal(result.isError, undefined);
      } else {
        assert.equal(result.isError, true);
        assert.match(block.text, /FORBIDDEN/);
      }

      await client.close();
    });
  }

  const unauthorized: readonly [string, string | undefined][] = [
    ['no header', undefined],
    ['a static bearer token', 'Bearer dev-qa-token'],
    ['a token for another audience', `Bearer ${token({ audience: 'other' })}`],
    [
      'a token signed with another secret',
      `Bearer ${token({ secret: 'another-secret-0123456789-abcdefghij' })}`,
    ],
    ['a token with a truncated signature', `Bearer ${token().slice(0, -2)}`],
  ];

  for (const [label, header] of unauthorized) {
    it(`refuses ${label} with a JSON-RPC error, not an HTML page`, async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(header ? { authorization: header } : {}),
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
  }
});
