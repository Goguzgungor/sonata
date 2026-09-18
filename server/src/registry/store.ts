import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { contracts, fnHints, settings } from './schema.js';
import type { ContractModel, ContractStatus, FnKind, JsonSchema, McpScope, Network, Step } from '../types.js';

export type ContractRow = {
  id: string; network: Network; name: string | null; owner: string | null; wasmHash: string | null; specLedger: number | null; specXdr: string[] | null;
  model: ContractModel | null; llmsTxt: string | null; openapi: JsonSchema | null; mcpScope: McpScope;
  status: ContractStatus; steps: Step[]; error: string | null; createdAt: Date; updatedAt: Date;
};
export type RowPatch = Partial<Omit<ContractRow, 'id' | 'createdAt' | 'updatedAt'>>;

export interface Store {
  /** Cheapest possible liveness probe — /healthz uses it instead of listing every row. */
  ping(): Promise<void>;
  get(id: string): Promise<ContractRow | null>;
  list(filter?: { owner?: string }): Promise<ContractRow[]>;
  /** Creates or re-queues a row. `owner` is stored on create and fills a NULL (legacy) owner; it never replaces an existing owner. */
  upsertQueued(id: string, network: Network, name: string | null, owner: string | null): Promise<ContractRow>;
  update(id: string, patch: RowPatch): Promise<ContractRow>;
  /** Atomically claims a legacy (owner NULL) row: sets `owner` only if it is still NULL. Returns the updated row, or null when the row is missing or already owned (a race the caller must handle, not overwrite). */
  claimOwner(id: string, owner: string): Promise<ContractRow | null>;
  getHints(id: string): Promise<Record<string, FnKind>>;
  setHint(id: string, fn: string, kind: FnKind): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** Inserts `value` only if `key` is absent, then returns whatever is now stored (the existing value on a race).
   *  Used for self-generated secrets so concurrently cold-booting instances converge on one value instead of
   *  each writing its own (setSetting is last-writer-wins and unsafe for that). */
  putSettingIfAbsent(key: string, value: string): Promise<string>;
}

export class MemoryStore implements Store {
  private rows = new Map<string, ContractRow>();
  private hints = new Map<string, Record<string, FnKind>>();
  private settings = new Map<string, string>();
  clear() { this.rows.clear(); this.hints.clear(); this.settings.clear(); }
  async ping() {}
  async get(id: string) { const r = this.rows.get(id); return r ? structuredClone(r) : null; }
  async list(filter: { owner?: string } = {}) {
    return [...this.rows.values()].filter((r) => filter.owner === undefined || r.owner === filter.owner)
      .map((r) => structuredClone(r)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  async upsertQueued(id: string, network: Network, name: string | null, owner: string | null) {
    const now = new Date();
    const existing = this.rows.get(id);
    const row: ContractRow = existing ? { ...existing, name: name ?? existing.name, owner: existing.owner ?? owner, status: 'queued', steps: [], error: null, updatedAt: now }
      : { id, network, name, owner, wasmHash: null, specLedger: null, specXdr: null, model: null, llmsTxt: null, openapi: null, mcpScope: 'ro', status: 'queued', steps: [], error: null, createdAt: now, updatedAt: now };
    this.rows.set(id, row); return structuredClone(row);
  }
  async update(id: string, patch: RowPatch) {
    const r = this.rows.get(id); if (!r) throw new Error(`no row ${id}`);
    const next = { ...r, ...patch, updatedAt: new Date() }; this.rows.set(id, next); return structuredClone(next);
  }
  async claimOwner(id: string, owner: string) {
    const r = this.rows.get(id); if (!r || r.owner) return null;
    const next = { ...r, owner, updatedAt: new Date() }; this.rows.set(id, next); return structuredClone(next);
  }
  async getHints(id: string) { return { ...(this.hints.get(id) ?? {}) }; }
  async setHint(id: string, fn: string, kind: FnKind) { this.hints.set(id, { ...(this.hints.get(id) ?? {}), [fn]: kind }); }
  async getSetting(key: string) { return this.settings.get(key) ?? null; }
  async setSetting(key: string, value: string) { this.settings.set(key, value); }
  async putSettingIfAbsent(key: string, value: string) {
    if (!this.settings.has(key)) this.settings.set(key, value);
    return this.settings.get(key)!;
  }
}

const toRow = (r: typeof contracts.$inferSelect): ContractRow => ({
  id: r.id, network: r.network as Network, name: r.name, owner: r.owner, wasmHash: r.wasmHash, specLedger: r.specLedger, specXdr: r.specXdr,
  model: r.model as ContractModel | null, llmsTxt: r.llmsTxt, openapi: r.openapi as JsonSchema | null, mcpScope: r.mcpScope as McpScope,
  status: r.status as ContractStatus, steps: r.steps as Step[], error: r.error, createdAt: r.createdAt, updatedAt: r.updatedAt
});

export class PgStore implements Store {
  private db;
  constructor(pool: pg.Pool) { this.db = drizzle(pool); }
  async ping() { await this.db.execute(sql`select 1`); }
  async get(id: string) { const [r] = await this.db.select().from(contracts).where(eq(contracts.id, id)); return r ? toRow(r) : null; }
  async list(filter: { owner?: string } = {}) {
    const q = this.db.select().from(contracts);
    const rows = filter.owner === undefined ? await q.orderBy(sql`${contracts.updatedAt} desc`) : await q.where(eq(contracts.owner, filter.owner)).orderBy(sql`${contracts.updatedAt} desc`);
    return rows.map(toRow);
  }
  async upsertQueued(id: string, network: Network, name: string | null, owner: string | null) {
    const [r] = await this.db.insert(contracts).values({ id, network, name, owner, status: 'queued', steps: [] })
      .onConflictDoUpdate({ target: contracts.id, set: { name: sql`coalesce(${name}, ${contracts.name})`, owner: sql`coalesce(${contracts.owner}, ${owner})`, status: 'queued', steps: [], error: null, updatedAt: sql`now()` } })
      .returning();
    return toRow(r);
  }
  async update(id: string, patch: RowPatch) {
    const [r] = await this.db.update(contracts).set({ ...patch, updatedAt: sql`now()` } as any).where(eq(contracts.id, id)).returning();
    if (!r) throw new Error(`no row ${id}`); return toRow(r);
  }
  async claimOwner(id: string, owner: string) {
    const [r] = await this.db.update(contracts).set({ owner, updatedAt: sql`now()` }).where(and(eq(contracts.id, id), isNull(contracts.owner))).returning();
    return r ? toRow(r) : null;
  }
  async getHints(id: string) {
    const rows = await this.db.select().from(fnHints).where(eq(fnHints.contractId, id));
    return Object.fromEntries(rows.map((h) => [h.fn, h.kind as FnKind]));
  }
  async setHint(id: string, fn: string, kind: FnKind) {
    await this.db.insert(fnHints).values({ contractId: id, fn, kind }).onConflictDoUpdate({ target: [fnHints.contractId, fnHints.fn], set: { kind, observedAt: sql`now()` } });
  }
  async getSetting(key: string) { const [r] = await this.db.select().from(settings).where(eq(settings.key, key)); return r ? r.value : null; }
  async setSetting(key: string, value: string) {
    await this.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }
  async putSettingIfAbsent(key: string, value: string) {
    await this.db.insert(settings).values({ key, value }).onConflictDoNothing({ target: settings.key });
    const [r] = await this.db.select().from(settings).where(eq(settings.key, key));
    return r!.value;
  }
}
