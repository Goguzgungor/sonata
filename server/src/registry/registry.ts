import PQueue from 'p-queue';
import { contract, StrKey } from '@stellar/stellar-sdk';
import type { Chain } from '../chain/types.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import type { ContractModel, FnKind, Network } from '../types.js';
import { buildModel } from '../spec/model.js';
import { runPipeline, type Generators } from './pipeline.js';
import type { ContractRow, Store } from './store.js';

type Cached = { model: ContractModel; spec: contract.Spec; wasmHash: string };

export class Registry {
  private queue = new PQueue({ concurrency: 2 });
  private cache = new Map<string, Cached>();
  private inflight = new Set<string>();
  constructor(private deps: { store: Store; chain: Chain; gen: Generators }) {}

  async register(id: string, network: Network, name: string | null = null): Promise<ContractRow> {
    if (!StrKey.isValidContract(id)) throw badRequest('invalid_contract_id', 'contract id must be a 56-character C… address');
    const row = await this.deps.store.upsertQueued(id, network, name);
    this.cache.delete(id);
    if (!this.inflight.has(id)) {
      this.inflight.add(id);
      void this.queue.add(() => runPipeline(this.deps, id, network).finally(() => this.inflight.delete(id)));
    }
    return row;
  }

  whenIdle() { return this.queue.onIdle(); }
  invalidate(id: string) { this.cache.delete(id); }

  /** Loads the row, requires it to exist and be ready (throwing 404 / 409 exactly as ready() does), and returns/builds the cached { model, spec } for it. Shared by ready() and learnHint() so both validate the contract the same way before touching it. */
  private async ensureCache(id: string): Promise<{ row: ContractRow; cached: Cached }> {
    const row = await this.deps.store.get(id);
    if (!row) throw notFound('contract', id);
    if (row.status !== 'ready' || !row.model || !row.specXdr) throw new ApiError(409, 'contract_not_ready', `contract is ${row.status}`, { details: { steps: row.steps, error: row.error } });
    let c = this.cache.get(id);
    if (!c || c.wasmHash !== row.wasmHash) {
      c = { model: row.model, spec: new contract.Spec(row.specXdr), wasmHash: row.wasmHash! };
      this.cache.set(id, c);
    }
    return { row, cached: c };
  }

  async ready(id: string): Promise<{ row: ContractRow; model: ContractModel; spec: contract.Spec }> {
    const { row, cached } = await this.ensureCache(id);
    return { row, model: cached.model, spec: cached.spec };
  }

  // Ruling: must work before any explicit ready() call — ensureCache() loads the row/cache entry
  // from the store itself instead of requiring one to already be populated.
  // Ruling (review finding): validate the contract via ensureCache() BEFORE touching hints, so an
  // unknown/not-ready id fails with a controlled 404/409 ApiError instead of setHint running first
  // (which, on PgStore, would otherwise hit the fn_hints -> contracts FK and throw a raw pg error).
  async learnHint(id: string, fn: string, kind: FnKind) {
    const { cached } = await this.ensureCache(id);
    await this.deps.store.setHint(id, fn, kind);
    const hints = await this.deps.store.getHints(id);
    const model = buildModel(cached.spec, { id: cached.model.id, network: cached.model.network, name: cached.model.name, wasmHash: cached.model.wasmHash, specLedger: cached.model.specLedger }, hints);
    cached.model = model;
    await this.deps.store.update(id, { model });
  }
}
