import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { badRequest, notFound } from '../../errors.js';
import { decodeResult, encodeArgs, namedContractError } from '../../spec/codec.js';

const NETWORK = z.enum(['testnet', 'mainnet']);
const CallBody = z.object({ args: z.record(z.string(), z.unknown()).default({}), source: z.string().optional(), network: NETWORK.optional() });
const TxBody = CallBody.extend({ source: z.string(), fee: z.string().regex(/^\d+$/).optional(), timeout_s: z.number().int().min(30).max(3600).optional() });
const SubmitBody = z.object({ xdr: z.string().min(1) });
const SUBMIT_WAIT_MS = 30_000;

export const invokeRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  const load = async (id: string, fn: string, network?: 'testnet' | 'mainnet') => {
    const r = await deps.registry.ready(id);
    if (!r.model.functions.some((f) => f.name === fn)) throw notFound('function', fn);
    if (network && network !== r.model.network) throw badRequest('network_mismatch', `contract is registered on ${r.model.network}`);
    return r;
  };

  app.post<{ Params: { id: string; fn: string } }>('/c/:id/call/:fn', async (req) => {
    const b = CallBody.parse(req.body);
    const { model, spec } = await load(req.params.id, req.params.fn, b.network);
    const scArgs = encodeArgs(spec, req.params.fn, b.args);
    const sim = await deps.chain.simulate(model.network, model.id, req.params.fn, scArgs, b.source ?? deps.cfg.simSourceAccount).catch((e) => namedContractError(e, model, spec));
    const kind = sim.auth.length === 0 && sim.readWriteCount === 0 ? 'read' : 'write';
    const current = model.functions.find((f) => f.name === req.params.fn)!.kind;
    if (current !== kind) {
      try { await deps.registry.learnHint(model.id, req.params.fn, kind); }
      catch (e) { req.log.warn({ err: e }, 'hint'); }
    }
    return { result: decodeResult(spec, req.params.fn, sim.retval), simulated: true, latency_ms: sim.latencyMs, ledger: sim.ledger, auth: sim.auth };
  });

  app.post<{ Params: { id: string; fn: string } }>('/c/:id/tx/:fn', async (req) => {
    const b = TxBody.parse(req.body);
    const { model, spec } = await load(req.params.id, req.params.fn, b.network);
    const scArgs = encodeArgs(spec, req.params.fn, b.args);
    const built = await deps.chain.buildTx(model.network, model.id, req.params.fn, scArgs, b.source, { fee: b.fee, timeoutS: b.timeout_s ?? 300 }).catch((e) => namedContractError(e, model, spec));
    return { xdr: built.xdr, fee: built.fee, auth: built.auth, ledger: built.ledger, expires_at: built.expiresAt };
  });

  const txJson = (t: { hash: string; status: string; ledger?: number; feeCharged?: string; resultXdr?: string }) =>
    ({ hash: t.hash, status: t.status, ...(t.ledger !== undefined && { ledger: t.ledger }), ...(t.feeCharged && { fee_charged: t.feeCharged }), ...(t.resultXdr && { result_xdr: t.resultXdr }) });

  app.post<{ Params: { id: string } }>('/c/:id/submit', async (req) => {
    const b = SubmitBody.parse(req.body);
    const { model } = await deps.registry.ready(req.params.id);
    return txJson(await deps.chain.submit(model.network, b.xdr, SUBMIT_WAIT_MS));
  });

  app.get<{ Params: { hash: string }; Querystring: { network?: string } }>('/tx/:hash', async (req) => {
    const network = NETWORK.safeParse(req.query.network);
    if (!network.success) throw badRequest('invalid_args', 'network query parameter is required (testnet|mainnet)');
    return txJson(await deps.chain.getTx(network.data, req.params.hash));
  });
};
