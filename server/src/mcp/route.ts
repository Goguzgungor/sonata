import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { Deps } from '../http/deps.js';
import { buildMcpServer } from './tools.js';
import { buildGlobalMcpServer } from './global.js';

const MCP_RATE_LIMIT = { max: 600, timeWindow: '1 minute' };

/** Connects a fresh, stateless Streamable HTTP transport to `server` and hands the raw request/response to it. */
async function serve(server: McpServer, req: FastifyRequest, reply: FastifyReply) {
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  reply.hijack();
  reply.raw.on('close', () => { void transport.close(); void server.close(); });
  await transport.handleRequest(req.raw, reply.raw, req.body);
}

/**
 * Stateless Streamable HTTP: a fresh McpServer + transport per request, built from the cached model.
 * Typed loosely over FastifyInstance's Logger/TypeProvider parameters: buildApp() constructs the app
 * with `loggerInstance: deps.log` (a concrete pino.Logger), which narrows its inferred FastifyInstance
 * type beyond the library's own `FastifyBaseLogger` default — a plain `FastifyInstance` parameter type
 * here does not structurally accept that narrower instance (app.route's RouteOptions is invariant in
 * Logger via childLoggerFactory), so this mirrors the project's own route modules (contracts.ts,
 * invoke.ts, docs.ts, health.ts), which sidestep the same mismatch by typing as FastifyPluginAsync.
 */
export function registerMcp(app: FastifyInstance<any, any, any, any, any>, deps: Deps) {
  app.route<{ Params: { id: string } }>({
    method: ['GET', 'POST', 'DELETE'],
    url: '/c/:id/mcp',
    config: { rateLimit: MCP_RATE_LIMIT },
    handler: async (req, reply) => {
      const { row, model, spec } = await deps.registry.ready(req.params.id);   // ApiError → JSON envelope via the app error handler
      const server = buildMcpServer(model, spec, row.mcpScope, deps);
      await serve(server, req, reply);
    }
  });
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    config: { rateLimit: MCP_RATE_LIMIT },
    handler: async (req, reply) => {
      const server = buildGlobalMcpServer(deps);
      await serve(server, req, reply);
    }
  });
}
