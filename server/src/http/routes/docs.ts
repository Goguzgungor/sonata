import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../deps.js';

export const docsRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { id: string } }>('/c/:id/llms.txt', async (req, reply) => {
    const { row } = await deps.registry.ready(req.params.id);
    return reply.type('text/markdown; charset=utf-8').send(row.llmsTxt ?? '');
  });
  app.get<{ Params: { id: string } }>('/c/:id/openapi.json', async (req) => (await deps.registry.ready(req.params.id)).row.openapi);
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>('/c/:id/events', async (req, reply) => {
    const q = req.query;
    if (q.format === 'csv') return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${req.params.id}-events.csv"`).send(await deps.history.csv(req.params.id, q));
    return deps.history.query(req.params.id, q);
  });
};
