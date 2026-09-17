import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../deps.js';
import type { Network } from '../../types.js';

export const healthRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.get('/healthz', async (_req, reply) => {
    const networks: Record<string, string> = {};
    for (const n of Object.keys(deps.cfg.networks) as Network[]) networks[n] = await deps.chain.health(n);
    let db = 'ok';
    try { await deps.store.list(); } catch { db = 'error'; }
    const ok = db === 'ok' && Object.values(networks).every((v) => v === 'ok');
    return reply.code(ok ? 200 : 503).send({ db, networks });
  });
};
