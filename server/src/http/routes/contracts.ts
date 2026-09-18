import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import type { ContractRow } from '../../registry/store.js';
import { notFound } from '../../errors.js';

const NETWORK = z.enum(['testnet', 'mainnet']);
const RegisterBody = z.object({ id: z.string(), network: NETWORK, name: z.string().min(1).max(80).optional() });
const PatchBody = z.object({ name: z.string().min(1).max(80).nullable().optional(), mcp_scope: z.enum(['ro', 'rw']).optional() });

export const publicRow = (row: ContractRow, base: string) => ({
  ...(row.model ?? { id: row.id, network: row.network, name: row.name }),
  name: row.name, mcp_scope: row.mcpScope, status: row.status, steps: row.steps, error: row.error,
  urls: { mcp: `${base}/c/${row.id}/mcp`, llms: `${base}/c/${row.id}/llms.txt`, openapi: `${base}/c/${row.id}/openapi.json` },
  created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString()
});

export const contractRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  const base = deps.cfg.publicBaseUrl;
  app.post('/contracts', async (req, reply) => {
    const b = RegisterBody.parse(req.body);
    if (!deps.cfg.networks[b.network]) return reply.code(400).send({ error: 'network_not_configured', message: `network ${b.network} is not configured on this server` });
    const row = await deps.registry.register(b.id, b.network, b.name ?? null);
    return reply.code(202).send({ id: row.id, network: row.network, status: row.status, steps: row.steps });
  });
  app.get('/contracts', async () => (await deps.store.list()).map((r) => ({ id: r.id, name: r.name, network: r.network, status: r.status, fns: r.model?.functions.length ?? 0, updated_at: r.updatedAt.toISOString() })));
  app.get<{ Params: { id: string } }>('/c/:id', async (req) => {
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    return publicRow(row, base);
  });
  app.get<{ Params: { id: string } }>('/c/:id/status', async (req) => {
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    return { status: row.status, steps: row.steps, error: row.error };
  });
  app.patch<{ Params: { id: string } }>('/c/:id', async (req) => {
    const b = PatchBody.parse(req.body);
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    if (b.mcp_scope !== undefined) await deps.store.update(row.id, { mcpScope: b.mcp_scope });
    if (b.name !== undefined) await deps.registry.rename(row.id, b.name);   // also regenerates llms.txt + openapi
    deps.registry.invalidate(row.id);
    return publicRow((await deps.store.get(row.id))!, base);
  });
};
