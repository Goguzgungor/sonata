import PQueue from 'p-queue';
import { contract } from '@stellar/stellar-sdk';
import type { Chain } from '../chain/types.js';
import { ApiError, notFound } from '../errors.js';
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

  /** Loads (or reuses) the cached { model, spec } for a row that already has a persisted model + specXdr. Returns null when there is nothing to cache yet. */
  private ensureCache(id: string, row: ContractRow): Cached | null {
    if (!row.model || !row.specXdr) return null;
    let c = this.cache.get(id);
    if (!c || c.wasmHash !== row.wasmHash) {
      c = { model: row.model, spec: new contract.Spec(row.specXdr), wasmHash: row.wasmHash! };
      this.cache.set(id, c);
    }
    return c;
  }

  async ready(id: string): Promise<{ row: ContractRow; model: ContractModel; spec: contract.Spec }> {
    const row = await this.deps.store.get(id);
    if (!row) throw notFound('contract', id);
    if (row.status !== 'ready' || !row.model || !row.specXdr) throw new ApiError(409, 'contract_not_ready', `contract is ${row.status}`, { details: { steps: row.steps, error: row.error } });
    const c = this.ensureCache(id, row)!; // model/specXdr are guaranteed by the check above
    return { row, model: c.model, spec: c.spec };
  }

  // Ruling: must work before any ready() call — it loads the cache entry from the store itself
  // (via ensureCache) instead of requiring one to already be populated.
  async learnHint(id: string, fn: string, kind: FnKind) {
    await this.deps.store.setHint(id, fn, kind);
    const row = await this.deps.store.get(id);
    if (!row) return;
    const c = this.ensureCache(id, row);
    if (!c) return; // no persisted spec/model yet — the pipeline will pick up the hint on its next run
    const hints = await this.deps.store.getHints(id);
    const model = buildModel(c.spec, { id: c.model.id, network: c.model.network, name: c.model.name, wasmHash: c.model.wasmHash, specLedger: c.model.specLedger }, hints);
    c.model = model;
    await this.deps.store.update(id, { model });
  }
}
