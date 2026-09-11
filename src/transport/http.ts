import type { Server as HttpServer } from 'node:http';

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createTeamServer } from '../team/team-server';
import type { ITeamDefinition } from '../team/team-definition';
import { isBearerAuthorized } from './bearer-auth';

/** JSON-RPC codes: a rejected token, an unreadable body, our own failure. */
const UNAUTHORIZED_RPC_CODE = -32001;

const PARSE_ERROR_RPC_CODE = -32700;

const INTERNAL_ERROR_RPC_CODE = -32603;

const DEFAULT_MCP_PATH = '/mcp';

const DEFAULT_HEALTH_PATH = '/health';

/** One intake draft is a few kilobytes; this bounds the parser generously. */
const MAX_BODY_SIZE = '256kb';

/** Only consulted when the caller opts into signal handling. */
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export interface IHttpTeamServerOptions {
  readonly port: number;
  /** Presented by the caller as `Authorization: Bearer <token>`. */
  readonly authToken: string;
  readonly path?: string;
  readonly healthPath?: string;
  /**
   * Close the listener on `SIGINT` and `SIGTERM`. Off by default.
   *
   * A library that installs process-wide handlers takes a decision that is the
   * caller's: an application embedding this server has its own shutdown order,
   * and a handler registered here would run beside it rather than within it.
   * Opting in closes the listener and nothing else — the process still ends
   * when the caller lets it.
   */
  readonly handleSignals?: boolean;
}

/**
 * Serves one team over streamable HTTP, for a host that reaches the server
 * across a network rather than spawning it.
 *
 * Stateless: `sessionIdGenerator: undefined` means every POST is
 * self-contained, so the server can be restarted underneath a running host
 * without stranding a session.
 *
 * The token is required rather than optional. An unauthenticated intake
 * endpoint is reachable by anyone who can route to it, and the failure is
 * silent — so a missing token stops the server starting instead.
 *
 * Lifecycle belongs to the caller: the listener is returned, and closing it is
 * theirs to do. Nothing here ends the process.
 *
 * @throws If `authToken` is blank.
 */
export function runHttpTeamServer(
  definition: ITeamDefinition,
  options: IHttpTeamServerOptions,
): HttpServer {
  const { port, authToken } = options;
  const handleSignals = options.handleSignals ?? false;
  const mcpPath = options.path ?? DEFAULT_MCP_PATH;
  const healthPath = options.healthPath ?? DEFAULT_HEALTH_PATH;

  if (authToken.trim().length === 0) {
    throw new Error('An auth token is required to serve a team over HTTP');
  }

  const app = express();

  // Express announces itself otherwise, which only helps someone fingerprinting.
  app.disable('x-powered-by');

  app.get(healthPath, (_request, response) => {
    response.json({ status: 'ok', team: definition.descriptor.team.key });
  });

  /**
   * The token check, ahead of the body parser.
   *
   * Order matters: a parser mounted first would run on an unauthenticated
   * request, exposing its own failure modes to anyone who can reach the port.
   */
  const authorize: RequestHandler = (request, response, next) => {
    if (!isBearerAuthorized(request.header('authorization'), authToken)) {
      // A protocol-level body rather than a bare 401: the caller is a JSON-RPC
      // client, and an HTML error page is not something it can report usefully.
      rpcError(response, 401, UNAUTHORIZED_RPC_CODE, 'Unauthorized');

      return;
    }

    next();
  };

  app.post(
    mcpPath,
    authorize,
    express.json({ limit: MAX_BODY_SIZE }),
    async (request, response) => {
      const server = createTeamServer(definition);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      // Closed together: one request, one server, one transport, nothing kept.
      response.on('close', () => {
        void transport.close();
        void server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
      } catch {
        // A caller that disconnects mid-request makes the transport throw, and
        // an unhandled rejection here would end the process — taking the
        // department offline over one abandoned request.
        //
        // The transport may already have answered by the time it throws. Writing
        // a second time raises ERR_HTTP_HEADERS_SENT, so a half-sent response is
        // dropped instead: the caller sees a broken connection, which is what
        // happened, rather than the server failing on its own error path.
        if (response.headersSent) {
          response.destroy();

          return;
        }

        rpcError(response, 500, INTERNAL_ERROR_RPC_CODE, 'Internal error');
      }
    },
  );

  app.use(onError);

  const listener = app.listen(port, () => {
    process.stdout.write(
      `intake-${definition.descriptor.team.key.toLowerCase()} MCP server listening on http://localhost:${port}${mcpPath}\n`,
    );
  });

  if (handleSignals) {
    // `once`, so repeated signals cannot stack handlers on a long-lived process.
    for (const signal of SHUTDOWN_SIGNALS) {
      process.once(signal, () => listener.close());
    }
  }

  return listener;
}

/**
 * Every failure answered as JSON-RPC, never as Express's own page.
 *
 * That default renders HTML and, outside production, includes the stack — so a
 * malformed body would hand the caller this server's paths. Nothing from the
 * error is echoed back: a rejected body is the caller's to fix, and anything
 * else is ours to find in our own logs.
 */
function onError(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);

    return;
  }

  const status = statusOf(error);

  if (status >= 400 && status < 500) {
    rpcError(response, status, PARSE_ERROR_RPC_CODE, 'Malformed request');

    return;
  }

  rpcError(response, 500, INTERNAL_ERROR_RPC_CODE, 'Internal error');
}

/** The status a body-parser rejection carries, when it carries one. */
function statusOf(error: unknown): number {
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate?.status ?? candidate?.statusCode;

  return typeof status === 'number' ? status : 500;
}

function rpcError(
  response: Response,
  status: number,
  code: number,
  message: string,
): void {
  response.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}
