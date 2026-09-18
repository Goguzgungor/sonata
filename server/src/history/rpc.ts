import type { rpc } from '@stellar/stellar-sdk';
import type { Config } from '../config.js';
import type { Network } from '../types.js';
import { ChainError, networkNotConfigured, rangeOutOfRetention, rpcUnavailable } from '../chain/errors.js';
import { defaultServerFactory, type ServerFactory } from '../chain/rpc.js';
import type { EventPage, EventQuery, HistorySource, Retention } from './types.js';

const RETENTION_TTL_MS = 60_000;
const iso = (unixSeconds: number | string) => new Date(Number(unixSeconds) * 1000).toISOString();   // SDK types RetentionState.latestLedgerCloseTime as a string of unix seconds

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

  private mapError(e: unknown): never {
    if (e instanceof ChainError) throw e;
    const m = /within the ledger range: (\d+) - (\d+)/.exec(String((e as Error)?.message ?? e));
    if (m) throw rangeOutOfRetention(Number(m[1]), Number(m[2]));
    throw rpcUnavailable('rpc', e);
  }

  async retention(network: Network): Promise<Retention> {
    const hit = this.retentionCache.get(network);
    if (hit && Date.now() - hit.at < RETENTION_TTL_MS) return hit.value;
    const server = this.server(network);
    try {
      const latest = (await server.getLatestLedger()).sequence;
      // A 1-event probe is the only way to learn oldestLedger/oldestLedgerCloseTime — getLatestLedger doesn't carry retention bounds.
      const probe = await server.getEvents({ startLedger: latest, filters: [], limit: 1 });
      const value: Retention = { oldestLedger: probe.oldestLedger, latestLedger: probe.latestLedger, latestLedgerCloseTime: iso(probe.latestLedgerCloseTime) };
      this.retentionCache.set(network, { at: Date.now(), value });
      return value;
    } catch (e) { this.mapError(e); }
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
    } catch (e) { this.mapError(e); }
  }
}
