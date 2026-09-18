import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import type { ContractRow } from '../../registry/store.js';
import { ApiError, notFound } from '../../errors.js';
import { requireSession } from '../session.js';

const NETWORK = z.enum(['testnet', 'mainnet']);
const RegisterBody = z.object({ id: z.string(), network: NETWORK, name: z.string().min(1).max(80).optional() });
const PatchBody = z.object({ name: z.string().min(1).max(80).nullable().optional(), mcp_scope: z.enum(['ro', 'rw']).optional() });

export const publicRow = (row: ContractRow, base: string) => ({
  ...(row.model ?? { id: row.id, network: row.network, name: row.name }),
  name: row.name, owner: row.owner, mcp_scope: row.mcpScope, status: row.status, steps: row.steps, error: row.error,
  urls: { mcp: `${base}/c/${row.id}/mcp`, llms: `${base}/c/${row.id}/llms.txt`, openapi: `${base}/c/${row.id}/openapi.json` },
  created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString()
});

const listItem = (r: ContractRow) => ({ id: r.id, name: r.name, network: r.network, status: r.status, fns: r.model?.functions.length ?? 0, owner: r.owner, created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString() });
const notOwner = (owner: string) => new ApiError(403, 'not_owner', 'this contract was registered by another wallet', { details: { owner } });

export const contractRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  const base = deps.cfg.publicBaseUrl;

  /** The row the caller may change: 404 unknown, 403 someone else's, and a legacy NULL owner is claimed on the spot.
   *  The claim itself goes through `claimOwner`, an atomic "set owner only if still NULL" — two concurrent PATCHes
   *  from different wallets can both pass the `!row.owner` read below, so only one of them may win the write. */
  const ownedRow = async (id: string, address: string) => {
    const row = await deps.store.get(id); if (!row) throw notFound('contract', id);
    if (row.owner && row.owner !== address) throw notOwner(row.owner);
    if (!row.owner) {
      const claimed = await deps.store.claimOwner(id, address);
      if (claimed) { deps.log.info({ id, address }, 'legacy contract claimed'); return claimed; }
      const now = await deps.store.get(id); if (!now) throw notFound('contract', id);
      throw notOwner(now.owner!);
    }
    return row;
  };

  app.post('/contracts', async (req, reply) => {
    const s = await requireSession(deps, req);
    const b = RegisterBody.parse(req.body);
    if (!deps.cfg.networks[b.network]) return reply.code(400).send({ error: 'network_not_configured', message: `network ${b.network} is not configured on this server` });
    const existing = await deps.store.get(b.id);
    if (existing?.owner && existing.owner !== s.address) throw notOwner(existing.owner);
    const row = await deps.registry.register(b.id, b.network, b.name ?? null, s.address);
    if (existing && !existing.owner && row.owner === s.address) deps.log.info({ id: b.id, address: s.address }, 'legacy contract claimed');
    return reply.code(202).send({ id: row.id, network: row.network, status: row.status, steps: row.steps, owner: row.owner });
  });
  app.get<{ Querystring: { owner?: string } }>('/contracts', async (req) => {
    if (req.query.owner === undefined) return (await deps.store.list()).map(listItem);
    if (req.query.owner !== 'me') throw new ApiError(400, 'invalid_args', 'owner may only be "me"', { details: { path: 'owner' } });
    const s = await requireSession(deps, req);
    return (await deps.store.list({ owner: s.address })).map(listItem);
  });
  app.get<{ Params: { id: string } }>('/c/:id', async (req) => {
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    return publicRow(row, base);
  });
  app.get<{ Params: { id: string } }>('/c/:id/status', async (req) => {
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    return { status: row.status, steps: row.steps, error: row.error };
  });
  app.patch<{ Params: { id: string } }>('/c/:id', async (req) => {
    const s = await requireSession(deps, req);
    const b = PatchBody.parse(req.body);
    const row = await ownedRow(req.params.id, s.address);
    if (b.mcp_scope !== undefined) await deps.store.update(row.id, { mcpScope: b.mcp_scope });
    if (b.name !== undefined) await deps.registry.rename(row.id, b.name);   // also regenerates llms.txt + openapi
    deps.registry.invalidate(row.id);
    return publicRow((await deps.store.get(row.id))!, base);
  });
};
