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

const DEFAULT_MAX = 100;
const DEFAULT_TTL_MS = 10_000;

/**
 * Bounds a fetched page to the query's `toLedger` and normalises a cursor the RPC still hands back
 * past the effective end of a page. stellar-rpc's `endLedger` is only honoured on the first page of a
 * query (a cursor page omits `startLedger`/`endLedger` entirely, since the RPC rejects a range and a
 * cursor together), so nothing re-applies `to` on page 2+ without this; the RPC also keeps returning a
 * non-null cursor at the very end of a range, which would otherwise show a "Load more" whose only
 * effect is an empty fetch (review finding I2).
 */
function boundPage(page: EventPage, toLedger: number, limit: number): EventPage {
  const kept = page.events.filter((e) => e.ledger <= toLedger);
  const dropped = kept.length < page.events.length;
  const lastLedger = kept.length ? kept[kept.length - 1].ledger : undefined;
  const cursor = dropped || (lastLedger !== undefined && lastLedger >= toLedger) || page.events.length < limit ? null : page.cursor;
  return { ...page, events: kept, cursor };
}

/**
 * Composes registryReady() -> normaliseQuery() -> topicFiltersFor() -> source.events() -> decodeEvent()
 * into the on-demand `GET /c/:id/events` read path. No ingestion: every request (cache misses aside)
 * is a live RPC round trip, so a small in-process LRU absorbs bursts of identical queries.
 */
export class HistoryService {
  private cache = new Map<string, { at: number; page: EventPage }>();
  // Single-flight: identical in-flight queries (same cache key) share one source.events() promise
  // instead of each firing its own RPC call — bounds worst-case fan-out from a burst of identical
  // requests (e.g. a page re-render, several agents polling the same filters) to one upstream call
  // (review finding M5-lite).
  private inflight = new Map<string, Promise<EventPage>>();
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
    const now = Date.now();
    // Sweep entries past their TTL before inserting: eviction below is otherwise purely size-driven,
    // so an expired entry sits in memory (holding its up-to-200 raw events) until 100 more distinct
    // keys push it out, however long that takes on a quiet contract (review finding I4).
    for (const [k, v] of this.cache) { if (now - v.at >= this.ttlMs) this.cache.delete(k); }
    this.cache.delete(key);
    this.cache.set(key, { at: now, page });
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
      let fetched = this.inflight.get(key);
      if (!fetched) {
        const eq: EventQuery = { contractId: id, network: model.network, startLedger: q.fromLedger, endLedger: q.toLedger, topics, cursor: q.cursor, limit: q.limit };
        fetched = this.source.events(eq).finally(() => this.inflight.delete(key));
        this.inflight.set(key, fetched);
      }
      page = boundPage(await fetched, q.toLedger, q.limit);
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
