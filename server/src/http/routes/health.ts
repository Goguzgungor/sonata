import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../deps.js';
import type { Network } from '../../types.js';

export const healthRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.get('/healthz', async (_req, reply) => {
    const networks: Record<string, string> = {};
    for (const n of Object.keys(deps.cfg.networks) as Network[]) networks[n] = await deps.chain.health(n);
    let db = 'ok';
    try { await deps.store.ping(); } catch { db = 'error'; }
    // Liveness is about this process: a degraded upstream RPC is reported in the body but must not
    // make the platform recycle an otherwise healthy instance (review finding I4).
    return reply.code(db === 'ok' ? 200 : 503).send({ db, networks });
  });
};
