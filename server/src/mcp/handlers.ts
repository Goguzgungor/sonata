import { StrKey } from '@stellar/stellar-sdk';
import type { contract } from '@stellar/stellar-sdk';
import type pino from 'pino';
import { ApiError, badRequest, notFound } from '../errors.js';
import type { Deps } from '../http/deps.js';
import type { ContractRow } from '../registry/store.js';
import type { ContractModel, JsonSchema, Network } from '../types.js';
import type { TxStatus } from '../chain/types.js';
import { decodeResult, encodeArgs, namedContractError } from '../spec/codec.js';
import { learnKind } from '../registry/hints-policy.js';

/** Row is only known once a contract is registered — the per-contract MCP server has no row in
 * hand (it is built straight from the already-loaded model/spec), so it leaves `row` unset. */
export type Ready = { row?: ContractRow; model: ContractModel; spec: contract.Spec };

const MAX_NAME = 64;
export const toolName = (prefix: string, fn: string) => `${prefix}${fn}`.slice(0, MAX_NAME);
export const sig = (f: ContractModel['functions'][number]) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;
export const withSource = (s: JsonSchema, required: boolean): JsonSchema => {
  const props = { ...(s.properties as object), source: { type: 'string', description: 'G… account used as transaction source' } };
  const req = [...((s.required as string[]) ?? []), ...(required ? ['source'] : [])];
  return { type: 'object', properties: props, ...(req.length ? { required: req } : {}), additionalProperties: false };
};
export const CALL_OUT: JsonSchema = { type: 'object', properties: { result: {}, simulated: { type: 'boolean' }, latency_ms: { type: 'integer' }, ledger: { type: 'integer' }, auth: { type: 'array', items: { type: 'string' } } }, required: ['result', 'simulated'] };
export const BUILD_OUT: JsonSchema = { type: 'object', properties: { xdr: { type: 'string' }, fee: { type: 'string' }, auth: { type: 'array', items: { type: 'string' } }, ledger: { type: 'integer' }, expires_at: { type: 'string' } }, required: ['xdr'] };
export const TX_OUT: JsonSchema = { type: 'object', properties: { hash: { type: 'string' }, status: { type: 'string' }, ledger: { type: 'integer' }, fee_charged: { type: 'string' }, return_value: { type: 'string', description: 'Returned ScVal (base64), on success only' }, result_xdr: { type: 'string', description: 'TransactionResult (base64)' } }, required: ['hash', 'status'] };
export const DOCS_OUT: JsonSchema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
/**
 * `limit` deliberately has no `minimum`/`maximum` here even though the range is 1–200: the MCP SDK
 * validates tool arguments against this schema BEFORE the handler runs, so a bound here would reject
 * an out-of-range `limit` as a transport-level ProtocolError (a generic "Input validation error"
 * string), not the `invalid_args` ApiError envelope every other error uses. The real 1–200 check
 * lives once, in history/query.ts's normaliseQuery (shared with the REST route) — same pattern as
 * checkBuildOpts's fee/timeout_s validation (review finding I1).
 */
export const EVENTS_IN: JsonSchema = { type: 'object', properties: { type: { type: 'string', description: 'event name (declared name or on-chain symbol)' }, address: { type: 'string', description: 'G… or C… address appearing in topics or data' }, from: { type: ['string', 'integer'], description: 'ledger sequence (string or number) or ISO-8601 time' }, to: { type: ['string', 'integer'], description: 'ledger sequence (string or number) or ISO-8601 time' }, cursor: { type: 'string' }, limit: { type: 'integer' } } };
export const EVENTS_OUT: JsonSchema = { type: 'object', properties: { events: { type: 'array', items: { type: 'object' } }, page: { type: 'object' }, retention: { type: 'object' } }, required: ['events', 'page', 'retention'] };
export const EVENTS_DESC = 'Decoded contract events from the network RPC (last ~7 days). Filters: type (event name), address (in topics/data), from/to (ledger or ISO time), cursor, limit ≤ 200.';

/** A bad `source` must come back as an invalid_args envelope, not a 500/502 from deeper in (review finding I2). */
export function checkSource(s: unknown, required: boolean) {
  if (s === undefined || s === null) {
    if (required) throw badRequest('invalid_args', 'source is required: a G… ed25519 public key', { path: 'source' });
    return;
  }
  if (typeof s !== 'string' || !StrKey.isValidEd25519PublicKey(s)) throw badRequest('invalid_args', 'source must be a G… ed25519 public key', { path: 'source' });
}

export const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> });
/**
 * Serializes an already-named error. Ruling: contract-error → spec-name renaming lives once, in
 * spec/codec.ts's namedContractError; callers rethrow through it and hand the renamed error here.
 * An ApiError's toJSON() is already a safe, intentional envelope and goes out verbatim; anything
 * else is an unexpected internal failure — it is logged (with the real error) and never echoed to
 * the caller, so raw messages like a database connection string never leak through the tool result
 * (review finding: fail() previously echoed `e.message` from any thrown value).
 */
export const failWith = (log: pino.Logger) => (e: unknown) => {
  if (e instanceof ApiError) return { content: [{ type: 'text' as const, text: JSON.stringify(e.toJSON()) }], isError: true };
  log.error({ err: e }, 'mcp tool failed');
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'internal', message: 'internal error' }) }], isError: true };
};

const requireFn = (model: ContractModel, fn: string) => { if (!model.functions.some((f) => f.name === fn)) throw notFound('function', fn); };

/** Simulate `fn` and, like the REST route, learn a read/write hint when the observed kind differs. */
export async function simulate(deps: Deps, r: Ready, fn: string, args: Record<string, unknown>, source?: unknown) {
  checkSource(source, false); requireFn(r.model, fn);
  try {
    const sim = await deps.chain.simulate(r.model.network, r.model.id, fn, encodeArgs(r.spec, fn, args), (source as string) ?? deps.cfg.simSourceAccount);
    const kind = sim.auth.length === 0 && sim.readWriteCount === 0 ? 'read' : 'write';
    await learnKind(deps, r.model, fn, kind, deps.log);
    return { result: decodeResult(r.spec, fn, sim.retval), simulated: true, latency_ms: sim.latencyMs, ledger: sim.ledger, auth: sim.auth };
  } catch (e) { namedContractError(e, r.model, r.spec); throw e; }
}
/** A bad `fee`/`timeout_s` must come back as an invalid_args envelope, not a chain-layer error (review finding I1) —
 * the REST route validates these with zod before this point; the MCP `build` tool has no such layer, so it lives here. */
function checkBuildOpts(opts: { fee?: string; timeoutS?: number }) {
  if (opts.fee !== undefined && !/^\d+$/.test(opts.fee)) throw badRequest('invalid_args', 'fee must be a non-negative integer in stroops', { path: 'fee' });
  if (opts.timeoutS !== undefined && (!Number.isInteger(opts.timeoutS) || opts.timeoutS < 30 || opts.timeoutS > 3600)) throw badRequest('invalid_args', 'timeout_s must be an integer between 30 and 3600', { path: 'timeout_s' });
}
export async function buildTx(deps: Deps, r: Ready, fn: string, args: Record<string, unknown>, source: unknown, opts: { fee?: string; timeoutS?: number } = {}) {
  checkSource(source, true); requireFn(r.model, fn); checkBuildOpts(opts);
  try {
    const b = await deps.chain.buildTx(r.model.network, r.model.id, fn, encodeArgs(r.spec, fn, args), source as string, { fee: opts.fee, timeoutS: opts.timeoutS ?? 300 });
    return { xdr: b.xdr, fee: b.fee, auth: b.auth, ledger: b.ledger, expires_at: b.expiresAt };
  } catch (e) { namedContractError(e, r.model, r.spec); throw e; }
}
export const txJson = (t: TxStatus) => ({ hash: t.hash, status: t.status, ...(t.ledger !== undefined && { ledger: t.ledger }), ...(t.feeCharged && { fee_charged: t.feeCharged }), ...(t.returnValue && { return_value: t.returnValue }), ...(t.resultXdr && { result_xdr: t.resultXdr }) });
export async function submitTx(deps: Deps, r: Ready, xdr: string) {
  try { return txJson(await deps.chain.submit(r.model.network, xdr, 30_000)); } catch (e) { namedContractError(e, r.model, r.spec); throw e; }
}
export const getTx = async (deps: Deps, network: Network, hash: string) => txJson(await deps.chain.getTx(network, hash));
export const searchFunctions = (model: ContractModel, query: string) => {
  const q = query.toLowerCase();
  return model.functions.filter((f) => f.name.toLowerCase().includes(q) || f.doc.toLowerCase().includes(q)).map((f) => ({ name: f.name, signature: sig(f), doc: f.doc, kind: f.kind })).sort((a, b) => a.name.localeCompare(b.name));
};
export const docsOf = async (deps: Deps, id: string) => (await deps.registry.ready(id)).row.llmsTxt ?? '';
export const getEvents = (deps: Deps, id: string, args: Record<string, unknown>) => deps.history.query(id, args);
