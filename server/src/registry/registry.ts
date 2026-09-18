import PQueue from 'p-queue';
import { contract, StrKey } from '@stellar/stellar-sdk';
import type { Chain } from '../chain/types.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import type { ContractModel, FnKind, Network } from '../types.js';
import { buildModel } from '../spec/model.js';
import { runPipeline, type Generators } from './pipeline.js';
import type { ContractRow, RowPatch, Store } from './store.js';

type Cached = { model: ContractModel; spec: contract.Spec; wasmHash: string };

/** Default cache cap. A contract.Spec plus its model is not small, and a public registry can hold far more contracts than fit in memory (review finding I7). */
const DEFAULT_CACHE_MAX = 256;

export class Registry {
  private queue = new PQueue({ concurrency: 2 });
  /** Insertion order is recency order: `get` re-inserts, and the oldest key is evicted past the cap. */
  private cache = new Map<string, Cached>();
  private cacheMax: number;
  private inflight = new Set<string>();
  constructor(private deps: { store: Store; chain: Chain; gen: Generators }, opts: { cacheMax?: number } = {}) {
    this.cacheMax = opts.cacheMax ?? DEFAULT_CACHE_MAX;
  }

  private cacheGet(id: string): Cached | undefined {
    const c = this.cache.get(id);
    if (c) { this.cache.delete(id); this.cache.set(id, c); }
    return c;
  }
  private cacheSet(id: string, c: Cached) {
    this.cache.delete(id);
    this.cache.set(id, c);
    while (this.cache.size > this.cacheMax) this.cache.delete(this.cache.keys().next().value!);
  }

  async register(id: string, network: Network, name: string | null = null, owner: string | null = null): Promise<ContractRow> {
    if (!StrKey.isValidContract(id)) throw badRequest('invalid_contract_id', 'contract id must be a 56-character C… address');
    const row = await this.deps.store.upsertQueued(id, network, name, owner);
    this.cache.delete(id);
    if (!this.inflight.has(id)) {
      this.inflight.add(id);
      // The pipeline writes a fresh model/docs row; drop the cache entry it may have raced with
      // (an unchanged wasm hash means ensureCache would otherwise keep serving the old model).
      void this.queue.add(() => runPipeline(this.deps, id, network).finally(() => { this.inflight.delete(id); this.cache.delete(id); }));
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
    let c = this.cacheGet(id);
    if (!c || c.wasmHash !== row.wasmHash) {
      c = { model: row.model, spec: new contract.Spec(row.specXdr), wasmHash: row.wasmHash! };
      this.cacheSet(id, c);
    }
    return { row, cached: c };
  }

  /**
   * Renames a contract and regenerates everything that embeds the name — the model, llms.txt's title
   * and the OpenAPI `info.title` — so a PATCH cannot leave the generated docs showing the old name
   * (review finding I9).
   */
  async rename(id: string, name: string | null): Promise<ContractRow> {
    const row = await this.deps.store.get(id);
    if (!row) throw notFound('contract', id);
    const patch: RowPatch = { name };
    if (row.model) {
      const model = { ...row.model, name };
      patch.model = model;
      patch.llmsTxt = this.deps.gen.llmsTxt(model);
      patch.openapi = this.deps.gen.openapi(model);
    }
    const updated = await this.deps.store.update(id, patch);
    this.cache.delete(id);
    return updated;
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
    const model = buildModel(cached.spec, { id: cached.model.id, network: cached.model.network, name: cached.model.name, wasmHash: cached.model.wasmHash, specLedger: cached.model.specLedger, sac: cached.model.sac }, hints);
    cached.model = model;
    await this.deps.store.update(id, { model });
  }
}
