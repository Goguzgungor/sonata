import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { contracts, fnHints } from './schema.js';
import type { ContractModel, ContractStatus, FnKind, JsonSchema, McpScope, Network, Step } from '../types.js';

export type ContractRow = {
  id: string; network: Network; name: string | null; wasmHash: string | null; specLedger: number | null; specXdr: string[] | null;
  model: ContractModel | null; llmsTxt: string | null; openapi: JsonSchema | null; mcpScope: McpScope;
  status: ContractStatus; steps: Step[]; error: string | null; createdAt: Date; updatedAt: Date;
};
export type RowPatch = Partial<Omit<ContractRow, 'id' | 'createdAt' | 'updatedAt'>>;

export interface Store {
  get(id: string): Promise<ContractRow | null>;
  list(): Promise<ContractRow[]>;
  upsertQueued(id: string, network: Network, name: string | null): Promise<ContractRow>;
  update(id: string, patch: RowPatch): Promise<ContractRow>;
  getHints(id: string): Promise<Record<string, FnKind>>;
  setHint(id: string, fn: string, kind: FnKind): Promise<void>;
}

export class MemoryStore implements Store {
  private rows = new Map<string, ContractRow>();
  private hints = new Map<string, Record<string, FnKind>>();
  clear() { this.rows.clear(); this.hints.clear(); }
  async get(id: string) { const r = this.rows.get(id); return r ? structuredClone(r) : null; }
  async list() { return [...this.rows.values()].map((r) => structuredClone(r)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()); }
  async upsertQueued(id: string, network: Network, name: string | null) {
    const now = new Date();
    const existing = this.rows.get(id);
    const row: ContractRow = existing ? { ...existing, name: name ?? existing.name, status: 'queued', steps: [], error: null, updatedAt: now }
      : { id, network, name, wasmHash: null, specLedger: null, specXdr: null, model: null, llmsTxt: null, openapi: null, mcpScope: 'ro', status: 'queued', steps: [], error: null, createdAt: now, updatedAt: now };
    this.rows.set(id, row); return structuredClone(row);
  }
  async update(id: string, patch: RowPatch) {
    const r = this.rows.get(id); if (!r) throw new Error(`no row ${id}`);
    const next = { ...r, ...patch, updatedAt: new Date() }; this.rows.set(id, next); return structuredClone(next);
  }
  async getHints(id: string) { return { ...(this.hints.get(id) ?? {}) }; }
  async setHint(id: string, fn: string, kind: FnKind) { this.hints.set(id, { ...(this.hints.get(id) ?? {}), [fn]: kind }); }
}

const toRow = (r: typeof contracts.$inferSelect): ContractRow => ({
  id: r.id, network: r.network as Network, name: r.name, wasmHash: r.wasmHash, specLedger: r.specLedger, specXdr: r.specXdr,
  model: r.model as ContractModel | null, llmsTxt: r.llmsTxt, openapi: r.openapi as JsonSchema | null, mcpScope: r.mcpScope as McpScope,
  status: r.status as ContractStatus, steps: r.steps as Step[], error: r.error, createdAt: r.createdAt, updatedAt: r.updatedAt
});

export class PgStore implements Store {
  private db;
  constructor(pool: pg.Pool) { this.db = drizzle(pool); }
  async get(id: string) { const [r] = await this.db.select().from(contracts).where(eq(contracts.id, id)); return r ? toRow(r) : null; }
  async list() { return (await this.db.select().from(contracts).orderBy(sql`${contracts.updatedAt} desc`)).map(toRow); }
  async upsertQueued(id: string, network: Network, name: string | null) {
    const [r] = await this.db.insert(contracts).values({ id, network, name, status: 'queued', steps: [] })
      .onConflictDoUpdate({ target: contracts.id, set: { name: sql`coalesce(${name}, ${contracts.name})`, status: 'queued', steps: [], error: null, updatedAt: sql`now()` } })
      .returning();
    return toRow(r);
  }
  async update(id: string, patch: RowPatch) {
    const [r] = await this.db.update(contracts).set({ ...patch, updatedAt: sql`now()` } as any).where(eq(contracts.id, id)).returning();
    if (!r) throw new Error(`no row ${id}`); return toRow(r);
  }
  async getHints(id: string) {
    const rows = await this.db.select().from(fnHints).where(eq(fnHints.contractId, id));
    return Object.fromEntries(rows.map((h) => [h.fn, h.kind as FnKind]));
  }
  async setHint(id: string, fn: string, kind: FnKind) {
    await this.db.insert(fnHints).values({ contractId: id, fn, kind }).onConflictDoUpdate({ target: [fnHints.contractId, fnHints.fn], set: { kind, observedAt: sql`now()` } });
  }
}
