import type { rpc } from '@stellar/stellar-sdk';
import type { Config } from '../config.js';
import type { Network } from '../types.js';
import { badRequest } from '../errors.js';
import { ChainError, networkNotConfigured, rangeOutOfRetention, rpcUnavailable } from '../chain/errors.js';
import { defaultServerFactory, type ServerFactory } from '../chain/rpc.js';
import type { EventPage, EventQuery, HistorySource, Retention } from './types.js';

const RETENTION_TTL_MS = 60_000;
const PROBE_LAG = 20;   // ledgers behind the observed head to probe at — a load-balanced RPC's getLatestLedger and getEvents can land on different nodes at different heights (review finding I1a)
const iso = (unixSeconds: number | string) => new Date(Number(unixSeconds) * 1000).toISOString();   // SDK types RetentionState.latestLedgerCloseTime as a string of unix seconds

/** Parses stellar-rpc's "startLedger must be within the ledger range: X - Y" message into its bounds. */
const parseRangeError = (e: unknown): { oldest: number; latest: number } | undefined => {
  const m = /within the ledger range: (\d+) - (\d+)/.exec(String((e as Error)?.message ?? e));
  return m ? { oldest: Number(m[1]), latest: Number(m[2]) } : undefined;
};

/** True for the raw JSON-RPC error object the SDK throws verbatim (jsonrpc.js: `throw response.data.error`) for invalid parameters — the only user-controlled RPC parameter that survives normaliseQuery is `cursor` (review finding I3). */
const isInvalidParams = (e: unknown): boolean => !!e && typeof e === 'object' && (e as { code?: unknown }).code === -32602;

/** v1 history: the network RPC's getEvents. Retention is whatever the RPC keeps (~7 days on public nodes). */
export class RpcHistorySource implements HistorySource {
  readonly name = 'rpc';
  private servers = new Map<Network, rpc.Server>();
  private retentionCache = new Map<Network, { at: number; value: Retention }>();
  constructor(private cfg: Config, private makeServer: ServerFactory = defaultServerFactory) {}

  private server(network: Network) {
    const n = this.cfg.networks[network];
    if (!n) throw networkNotConfigured(network);
    let s = this.servers.get(network);
    if (!s) { s = this.makeServer(n); this.servers.set(network, s); }
    return s;
  }

  /**
   * `startLedger`, when given, is the request's own lower bound: only a range error whose parsed
   * `oldest` bound is above it is genuinely `range_out_of_retention` (the caller asked for history the
   * RPC no longer has). Any other range error — in particular a `startLedger` the caller derived from
   * a `latestLedger` that a slower, load-balanced node hasn't reached yet — is an upstream hiccup, not
   * a client mistake, and surfaces as `rpc_unavailable` instead (review finding I1c).
   */
  private mapError(e: unknown, network: Network, startLedger?: number): never {
    if (e instanceof ChainError) throw e;
    if (isInvalidParams(e)) throw badRequest('invalid_args', 'cursor is not a valid event cursor', { path: 'cursor' });
    const bounds = parseRangeError(e);
    if (bounds && startLedger !== undefined && startLedger < bounds.oldest) throw rangeOutOfRetention(bounds.oldest, bounds.latest);
    throw rpcUnavailable(network, e);
  }

  async retention(network: Network): Promise<Retention> {
    const hit = this.retentionCache.get(network);
    if (hit && Date.now() - hit.at < RETENTION_TTL_MS) return hit.value;
    const server = this.server(network);
    const probeAt = (startLedger: number) => server.getEvents({ startLedger, filters: [], limit: 1 });
    try {
      const latest = (await server.getLatestLedger()).sequence;
      // A 1-event probe is the only way to learn oldestLedger/oldestLedgerCloseTime — getLatestLedger
      // doesn't carry retention bounds. Probed a little behind the head rather than exactly at it (I1a).
      const probe = await probeAt(Math.max(1, latest - PROBE_LAG));
      const value: Retention = { oldestLedger: probe.oldestLedger, latestLedger: probe.latestLedger, latestLedgerCloseTime: iso(probe.latestLedgerCloseTime) };
      this.retentionCache.set(network, { at: Date.now(), value });
      return value;
    } catch (e) {
      const bounds = parseRangeError(e);
      if (!bounds) this.mapError(e, network);
      // The probe still landed ahead of a lagging node's head even after backing off — the range
      // error itself carries the true bounds, so use them as the retention instead of failing every
      // request during the skew (review finding I1b). One more probe (at the parsed latest, backed
      // off again) is needed for latestLedgerCloseTime, which the error message doesn't carry.
      try {
        const probe2 = await probeAt(Math.max(1, bounds.latest - PROBE_LAG));
        const value: Retention = { oldestLedger: bounds.oldest, latestLedger: bounds.latest, latestLedgerCloseTime: iso(probe2.latestLedgerCloseTime) };
        this.retentionCache.set(network, { at: Date.now(), value });
        return value;
      } catch (e2) { throw rpcUnavailable(network, e2); }
    }
  }

  async events(q: EventQuery): Promise<EventPage> {
    const server = this.server(q.network);
    const filter: rpc.Api.EventFilter = { type: 'contract', contractIds: [q.contractId], ...(q.topics?.length ? { topics: q.topics } : {}) };
    try {
      const r = await (q.cursor
        ? server.getEvents({ filters: [filter], cursor: q.cursor, limit: q.limit })
        : server.getEvents({ filters: [filter], startLedger: q.startLedger, endLedger: q.endLedger, limit: q.limit }));
      return {
        events: r.events.map((e) => ({
          id: e.id,
          ledger: e.ledger,
          closedAt: e.ledgerClosedAt,
          txHash: e.txHash,
          inSuccessfulContractCall: e.inSuccessfulContractCall,
          topic: e.topic.map((t) => t.toXDR('base64')),
          value: e.value.toXDR('base64')
        })),
        cursor: r.events.length > 0 && r.cursor ? r.cursor : null,
        oldestLedger: r.oldestLedger,
        latestLedger: r.latestLedger,
        latestLedgerCloseTime: iso(r.latestLedgerCloseTime)
      };
    } catch (e) { this.mapError(e, q.network, q.startLedger); }
  }
}
