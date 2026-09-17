import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../deps.js';
import { ApiError } from '../../errors.js';

export const docsRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { id: string } }>('/c/:id/llms.txt', async (req, reply) => {
    const { row } = await deps.registry.ready(req.params.id);
    return reply.type('text/markdown; charset=utf-8').send(row.llmsTxt ?? '');
  });
  app.get<{ Params: { id: string } }>('/c/:id/openapi.json', async (req) => (await deps.registry.ready(req.params.id)).row.openapi);
  app.get<{ Params: { id: string } }>('/c/:id/events', async (req) => {
    await deps.registry.ready(req.params.id);
    throw new ApiError(501, 'not_indexed', 'event history is not indexed yet; it arrives in a later milestone');
  });
};
