import type { IServiceTokenOptions } from '../auth/service-token';
import { requiredEnv } from './env.helper';

/**
 * A team server's service-token settings, read from `<PREFIX>_MCP_JWT_*`.
 *
 * | Variable                     | Shape                                        |
 * | ---------------------------- | -------------------------------------------- |
 * | `<PREFIX>_MCP_JWT_SECRET`    | At least 32 characters, shared with the host |
 * | `<PREFIX>_MCP_JWT_ISSUER`    | The host's name, e.g. `example-host`         |
 * | `<PREFIX>_MCP_JWT_AUDIENCE`  | This server's name as the host addresses it  |
 *
 * Call it at startup, so a missing value stops the server rather than leaving
 * it up and refusing every request.
 *
 * @throws If a variable is absent or blank.
 */
export function serviceAuthFromEnv(prefix: string): IServiceTokenOptions {
  return {
    secret: requiredEnv(`${prefix}_MCP_JWT_SECRET`),
    issuer: requiredEnv(`${prefix}_MCP_JWT_ISSUER`),
    audience: requiredEnv(`${prefix}_MCP_JWT_AUDIENCE`),
  };
}
