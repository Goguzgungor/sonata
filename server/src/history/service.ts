import type { contract } from '@stellar/stellar-sdk';
import type { ContractModel } from '../types.js';
import type { EventPage, EventQuery, HistorySource } from './types.js';
import { normaliseQuery } from './query.js';
import { decodeEvent, matchesAddress, topicFiltersFor, type DecodedEvent } from './decode.js';
import { toCsv } from './csv.js';

type Ready = { model: ContractModel; spec: contract.Spec };
export type RegistryReady = (id: string) => Promise<Ready>;

export type EventsResponse = {
  events: DecodedEvent[];
  page: { cursor: string | null; limit: number; from_ledger: number; to_ledger: number };
  retention: { oldest_ledger: number; latest_ledger: number; latest_ledger_close_time: string; note: string };
};

const DEFAULT_MAX = 500;
const DEFAULT_TTL_MS = 10_000;

/**
 * Composes registryReady() -> normaliseQuery() -> topicFiltersFor() -> source.events() -> decodeEvent()
 * into the on-demand `GET /c/:id/events` read path. No ingestion: every request (cache misses aside)
 * is a live RPC round trip, so a small in-process LRU absorbs bursts of identical queries.
 */
export class HistoryService {
  private cache = new Map<string, { at: number; page: EventPage }>();
  private readonly max: number;
  private readonly ttlMs: number;

  constructor(private source: HistorySource, private registryReady: RegistryReady, opts: { ttlMs?: number; max?: number } = {}) {
    this.max = opts.max ?? DEFAULT_MAX;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  private cacheGet(key: string): EventPage | undefined {
    const hit = this.cache.get(key);
    if (!hit || Date.now() - hit.at >= this.ttlMs) { if (hit) this.cache.delete(key); return undefined; }
    this.cache.delete(key);
    this.cache.set(key, hit);   // refresh recency on a hit
    return hit.page;
  }
  private cacheSet(key: string, page: EventPage) {
    this.cache.delete(key);
    this.cache.set(key, { at: Date.now(), page });
    while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Shared by query() and csv(): resolves the contract, normalises + runs the query (cached), decodes, and post-filters by address. */
  private async run(id: string, raw: Record<string, unknown>) {
    const { model, spec } = await this.registryReady(id);
    const retention = await this.source.retention(model.network);
    const q = normaliseQuery(raw, retention);
    const topics = q.type ? topicFiltersFor(spec, q.type) : undefined;
    const key = JSON.stringify([id, model.network, q.fromLedger, q.toLedger, topics, q.cursor, q.limit]);
    let page = this.cacheGet(key);
    if (!page) {
      const eq: EventQuery = { contractId: id, network: model.network, startLedger: q.fromLedger, endLedger: q.toLedger, topics, cursor: q.cursor, limit: q.limit };
      page = await this.source.events(eq);
      this.cacheSet(key, page);
    }
    let events = page.events.map((e) => decodeEvent(e, spec, model.network));
    if (q.address) events = events.filter((e) => matchesAddress(e, q.address!));
    return { events, q, page };
  }

  async query(id: string, raw: Record<string, unknown>): Promise<EventsResponse> {
    const { events, q, page } = await this.run(id, raw);
    return {
      events,
      page: { cursor: page.cursor, limit: q.limit, from_ledger: q.fromLedger, to_ledger: q.toLedger },
      retention: { oldest_ledger: page.oldestLedger, latest_ledger: page.latestLedger, latest_ledger_close_time: page.latestLedgerCloseTime, note: 'RPC history covers the last ~7 days' }
    };
  }

  async csv(id: string, raw: Record<string, unknown>): Promise<string> {
    const { events } = await this.run(id, raw);
    return toCsv(events);
  }
}
