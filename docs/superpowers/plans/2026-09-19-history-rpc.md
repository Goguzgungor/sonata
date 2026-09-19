# M5 — History v1 (RPC events proxy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /c/:id/events` returns a contract's decoded events read on demand from the network RPC (last ~7 days), with type/address/range filters, cursor paging and CSV; MCP `get_events` (per-contract + global) and a live History tab use the same data. Nothing is ingested.

**Architecture:** A `HistorySource` interface (`server/src/history/types.ts`) with one implementation, `RpcHistorySource` (`getEvents` + retention cache). `history/query.ts` normalises the public query (times→ledgers, clamps, `type`→topic filters, limits) and `history/decode.ts` turns raw XDR events into the JSON contract using the contract's spec (`scValToNative` + the existing `toJson`). `history/service.ts` composes them behind a 10 s in-process cache and serves the REST route, the MCP tools and CSV. The site's History tab calls `contracts.events()`.

**Tech Stack:** Server TypeScript ESM, Fastify 5, `@stellar/stellar-sdk` 17 (`rpc.Server.getEvents`, `scValToNative`, `xdr`), zod 4, vitest. Site Next.js 15 JS/JSX, vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-history-rpc-design.md`

## Global Constraints

- Branch `m5-history` (from `main` b828872). Server TypeScript ESM (`.js` import suffixes); site JS/JSX only; tests `server/test/**/*.test.ts` and `test/site/**`.
- Error envelope `{ error, message, code?, details? }`. New code: `range_out_of_retention` (400, `details: { oldest_ledger, latest_ledger }`). Existing: `contract_not_found` 404, `contract_not_ready` 409, `invalid_args` 400, `rpc_unavailable` 502.
- Query contract (exact): `type`, `address`, `from`, `to` (ledger integer or ISO-8601), `cursor`, `limit` (1–200, default 50), `format` (`json`|`csv`). Defaults: `to` = latest ledger, `from` = max(oldest, latest − 17 280). Times→ledgers: `ledger = latest − round((latestCloseTime − t) / 5.5)`, clamped to `[oldest, latest]`.
- Response (exact keys): `{ events: [{ id, ledger, closed_at, tx_hash, successful, event, topics, data, raw: { topic, value }, explorer_url }], page: { cursor, limit, from_ledger, to_ledger }, retention: { oldest_ledger, latest_ledger, latest_ledger_close_time, note } }`; `note` = `RPC history covers the last ~7 days`. CSV columns: `id,ledger,closed_at,tx_hash,successful,event,topics,data` (`topics`/`data` JSON-encoded).
- Soroban `#[contractevent]` semantics (verified on the fixture): spec entry `scSpecEntryEventV0` value `{ name: 'Pinged', prefix_topics: ['pinged'], params: [{ name: 'who', location: 'topic_list', type }, { name: 'n', location: 'data', type }], data_format: 'map' | 'vec' | 'single_value' }`; on chain topics = `[...prefix_topics, ...topic_list params]`, data = map keyed by param name (`map`), a vec in param order (`vec`) or the lone value (`single_value`). `type` is resolved against the spec case-insensitively (declared name `Pinged` or prefix topic `pinged` → `pinged`); unknown names pass through verbatim.
- `type` (resolved symbol) → RPC topic filters on topic[0] for every topic count: `[[sym], [sym,'*'], [sym,'*','*'], [sym,'*','*','*']]` where `sym` = base64 XDR of `ScVal.scvSymbol(type)`. `address` is a post-filter over decoded `topics` and `data` (recursively, string equality) within the fetched page.
- Cache: in-process LRU (max 500 entries) keyed by the exact `EventQuery`, TTL 10 s; retention cached 60 s per network.
- MCP tool name `get_events`; tool counts become `N+3` (ro) / `2N+4` (rw) everywhere (site `mcpToolCount`, tests, Playwright).
- Commit per task, body ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never touch `.env*` files.

---

## File structure

Server (create): `src/history/types.ts`, `src/history/rpc.ts`, `src/history/query.ts`, `src/history/decode.ts`, `src/history/service.ts`, `src/history/csv.ts`, `test/helpers/fakeHistory.ts`, `test/history/{rpc,query,decode,service}.test.ts`, `test/http/events.test.ts`.
Server (modify): `src/http/deps.ts`, `src/main.ts`, `src/http/routes/docs.ts` (events route), `src/docs/openapi.ts` (+`/events` path), `src/docs/llms.ts` (+ snapshot), `src/mcp/handlers.ts`, `src/mcp/tools.ts`, `src/mcp/global.ts`, `test/helpers/app.ts`, `test/mcp/{tools,global}.test.ts`, `test/e2e/flow.test.ts`, `README.md`, `src/chain/errors.ts`.
Site (modify): `lib/api.js`, `components/workspace/History.jsx`, `components/workspace/Overview.jsx`, `components/docs-data.js`, `test/site/history.test.jsx`, `e2e/site.spec.ts`, `README.md`.

---

### Task 1: `HistorySource` + `RpcHistorySource`

**Files:**
- Create: `server/src/history/types.ts`, `server/src/history/rpc.ts`, `server/test/history/rpc.test.ts`
- Modify: `server/src/chain/errors.ts` (add `rangeOutOfRetention`), `server/src/chain/rpc.ts` (export `ServerFactory`, `defaultServerFactory`)

**Interfaces (produces):**

```ts
// types.ts
export type Retention = { oldestLedger: number; latestLedger: number; latestLedgerCloseTime: string };
export type EventQuery = { contractId: string; network: Network; startLedger: number; endLedger?: number; topics?: string[][]; cursor?: string; limit: number };
export type RawEvent = { id: string; ledger: number; closedAt: string; txHash: string; inSuccessfulContractCall: boolean; topic: string[]; value: string };
export type EventPage = { events: RawEvent[]; cursor: string | null } & Retention;
export interface HistorySource { readonly name: string; retention(network: Network): Promise<Retention>; events(q: EventQuery): Promise<EventPage>; }
```

- [ ] **Step 1: Failing test** — `server/test/history/rpc.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { loadConfig } from '../../src/config.js';
import { RpcHistorySource } from '../../src/history/rpc.js';
import { FIXTURE_ID } from '../fixtures/index.js';

const cfg = loadConfig({ DATABASE_URL: 'postgres://unused' });
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const ev = (id: string, ledger: number) => ({ id, type: 'contract', ledger, ledgerClosedAt: '2026-09-18T16:13:58Z', transactionIndex: 1, operationIndex: 0, inSuccessfulContractCall: true, txHash: 'ab'.repeat(32), contractId: { contractId: () => FIXTURE_ID }, topic: [sym('pinged'), nativeToScVal('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', { type: 'address' })], value: nativeToScVal(7, { type: 'u32' }) });
const page = { events: [ev('0001-1', 100), ev('0002-1', 101)], latestLedger: 200, latestLedgerCloseTime: '1789751923', oldestLedger: 10, oldestLedgerCloseTime: '1789700000', cursor: '0002-1' };
const source = (server: Record<string, unknown>) => new RpcHistorySource(cfg, () => server as never);

describe('RpcHistorySource', () => {
  it('maps getEvents to RawEvent pages (base64 XDR, cursor, retention)', async () => {
    const getEvents = vi.fn().mockResolvedValue(page);
    const s = source({ getEvents, getLatestLedger: vi.fn() });
    const r = await s.events({ contractId: FIXTURE_ID, network: 'testnet', startLedger: 50, endLedger: 150, topics: [['AAAADwAAAAZwaW5nZWQ=', '*']], limit: 2 });
    expect(getEvents).toHaveBeenCalledWith({ startLedger: 50, endLedger: 150, filters: [{ type: 'contract', contractIds: [FIXTURE_ID], topics: [['AAAADwAAAAZwaW5nZWQ=', '*']] }], limit: 2 });
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toMatchObject({ id: '0001-1', ledger: 100, closedAt: '2026-09-18T16:13:58Z', txHash: 'ab'.repeat(32), inSuccessfulContractCall: true });
    expect(r.events[0].topic[0]).toBe(sym('pinged').toXDR('base64')); expect(r.events[0].value).toBe(nativeToScVal(7, { type: 'u32' }).toXDR('base64'));
    expect(r).toMatchObject({ cursor: '0002-1', oldestLedger: 10, latestLedger: 200, latestLedgerCloseTime: new Date(1789751923 * 1000).toISOString() });
  });
  it('passes cursor instead of startLedger when paging, and null cursor on an empty tail', async () => {
    const getEvents = vi.fn().mockResolvedValue({ ...page, events: [], cursor: '' });
    const s = source({ getEvents });
    const r = await s.events({ contractId: FIXTURE_ID, network: 'testnet', startLedger: 50, cursor: '0002-1', limit: 5 });
    expect(getEvents.mock.calls[0][0]).toMatchObject({ cursor: '0002-1', limit: 5 }); expect(getEvents.mock.calls[0][0].startLedger).toBeUndefined();
    expect(r.cursor).toBeNull();
  });
  it('maps an out-of-window startLedger to 400 range_out_of_retention and other failures to 502', async () => {
    const s = source({ getEvents: vi.fn().mockRejectedValue(new Error('startLedger must be within the ledger range: 10 - 200')) });
    await expect(s.events({ contractId: FIXTURE_ID, network: 'testnet', startLedger: 1, limit: 1 })).rejects.toMatchObject({ status: 400, error: 'range_out_of_retention', extra: { details: { oldest_ledger: 10, latest_ledger: 200 } } });
    const t = source({ getEvents: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) });
    await expect(t.events({ contractId: FIXTURE_ID, network: 'testnet', startLedger: 1, limit: 1 })).rejects.toMatchObject({ status: 502, error: 'rpc_unavailable' });
  });
  it('retention() uses getLatestLedger + a 1-event probe and caches for 60 s', async () => {
    const getLatestLedger = vi.fn().mockResolvedValue({ sequence: 200 });
    const getEvents = vi.fn().mockResolvedValue({ ...page, events: [] });
    const s = source({ getLatestLedger, getEvents });
    expect(await s.retention('testnet')).toEqual({ oldestLedger: 10, latestLedger: 200, latestLedgerCloseTime: new Date(1789751923 * 1000).toISOString() });
    await s.retention('testnet');
    expect(getEvents).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd server && npx vitest run test/history/rpc.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`server/src/chain/errors.ts` — add:

```ts
export const rangeOutOfRetention = (oldest: number, latest: number) =>
  new ChainError(400, 'range_out_of_retention', `the requested ledger range is outside the RPC's event retention window (${oldest}–${latest})`, { details: { oldest_ledger: oldest, latest_ledger: latest } });
```

`server/src/chain/rpc.ts`: `export` both `ServerFactory` (already exported) and `defaultServerFactory`.

`server/src/history/rpc.ts`:

```ts
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
    const n = this.cfg.networks[network]; if (!n) throw networkNotConfigured(network);
    let s = this.servers.get(network); if (!s) { s = this.makeServer(n); this.servers.set(network, s); } return s;
  }
  private mapError(e: unknown): never {
    if (e instanceof ChainError) throw e;
    const m = /within the ledger range: (\d+) - (\d+)/.exec(String((e as Error)?.message ?? e));
    if (m) throw rangeOutOfRetention(Number(m[1]), Number(m[2]));
    throw rpcUnavailable('rpc', e);
  }

  async retention(network: Network): Promise<Retention> {
    const hit = this.retentionCache.get(network); if (hit && Date.now() - hit.at < RETENTION_TTL_MS) return hit.value;
    const server = this.server(network);
    try {
      const latest = (await server.getLatestLedger()).sequence;
      const probe = await server.getEvents({ startLedger: latest, filters: [], limit: 1 } as never);
      const value: Retention = { oldestLedger: probe.oldestLedger, latestLedger: probe.latestLedger, latestLedgerCloseTime: iso(probe.latestLedgerCloseTime) };
      this.retentionCache.set(network, { at: Date.now(), value }); return value;
    } catch (e) { this.mapError(e); }
  }

  async events(q: EventQuery): Promise<EventPage> {
    const server = this.server(q.network);
    const filter: Record<string, unknown> = { type: 'contract', contractIds: [q.contractId], ...(q.topics?.length ? { topics: q.topics } : {}) };
    const req: Record<string, unknown> = q.cursor ? { cursor: q.cursor, limit: q.limit, filters: [filter] } : { startLedger: q.startLedger, ...(q.endLedger !== undefined ? { endLedger: q.endLedger } : {}), filters: [filter], limit: q.limit };
    try {
      const r = await server.getEvents(req as never);
      return {
        events: r.events.map((e) => ({ id: e.id, ledger: e.ledger, closedAt: e.ledgerClosedAt, txHash: e.txHash, inSuccessfulContractCall: e.inSuccessfulContractCall, topic: e.topic.map((t) => t.toXDR('base64')), value: e.value.toXDR('base64') })),
        cursor: r.events.length > 0 && r.cursor ? r.cursor : null,
        oldestLedger: r.oldestLedger, latestLedger: r.latestLedger, latestLedgerCloseTime: iso(r.latestLedgerCloseTime)
      };
    } catch (e) { this.mapError(e); }
  }
}
```

(If the SDK's `GetEventsRequest` type rejects `filters: []` for the probe, use `{ type: 'contract' }` with no contractIds. Check `rpc.Api.GetEventsResponse` field names against the installed d.ts — `RetentionState.latestLedgerCloseTime` is typed `string` (unix seconds) there — always go through `Number()`.)

- [ ] **Step 4: Run** — `npx vitest run test/history/rpc.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git add server/src/history server/src/chain server/test/history && git commit -m "server: HistorySource interface and RPC getEvents adapter" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 2: query normalisation, decoding, CSV

**Files:**
- Create: `server/src/history/query.ts`, `server/src/history/decode.ts`, `server/src/history/csv.ts`, `server/test/history/query.test.ts`, `server/test/history/decode.test.ts`

**Interfaces (produces):**
- `normaliseQuery(raw: Record<string, unknown>, retention: Retention): { type?: string; address?: string; fromLedger: number; toLedger: number; cursor?: string; limit: number; format: 'json' | 'csv' }` — throws `badRequest('invalid_args', …, { path })`; `topicFilters(symbol: string): string[][]` builds the four topic[0] filters.
- `topicFiltersFor(spec: contract.Spec, type: string): string[][]` (declared event name or prefix topic, case-insensitive → `[spec.eventTopicFilter(name)]`; else the four wildcard rows from `topicFilters(type)`); `decodeEvent(raw: RawEvent, spec: contract.Spec, network: Network): DecodedEvent` (declared events go through the SDK's `spec.parseEvent` → `data` = all params by name; undeclared events decode generically) with `DecodedEvent = { id, ledger, closed_at, tx_hash, successful, event: string | null, topics: unknown[], data: unknown, raw: { topic: string[]; value: string }, explorer_url }`.
- `matchesAddress(ev: DecodedEvent, address: string): boolean`.
- `toCsv(events: DecodedEvent[]): string`.

- [ ] **Step 1: Failing tests**

`server/test/history/query.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { xdr } from '@stellar/stellar-sdk';
import { normaliseQuery, topicFilters } from '../../src/history/query.js';

const ret = { oldestLedger: 1000, latestLedger: 200_000, latestLedgerCloseTime: '2026-09-19T00:00:00.000Z' };
describe('normaliseQuery', () => {
  it('defaults: last ~24h, limit 50, json', () => {
    expect(normaliseQuery({}, ret)).toMatchObject({ fromLedger: 200_000 - 17_280, toLedger: 200_000, limit: 50, format: 'json' });
  });
  it('accepts ledgers or ISO times, clamps to retention', () => {
    expect(normaliseQuery({ from: '500', to: '150000' }, ret)).toMatchObject({ fromLedger: 1000, toLedger: 150_000 });
    const oneHourAgo = new Date(Date.parse(ret.latestLedgerCloseTime) - 3600_000).toISOString();
    expect(normaliseQuery({ from: oneHourAgo }, ret).fromLedger).toBe(200_000 - Math.round(3600 / 5.5));
    expect(normaliseQuery({ to: '9999999' }, ret).toLedger).toBe(200_000);
  });
  it('rejects bad input with invalid_args + path', () => {
    for (const [raw, path] of [[{ limit: '0' }, 'limit'], [{ limit: '201' }, 'limit'], [{ from: 'yesterday' }, 'from'], [{ address: 'nope' }, 'address'], [{ format: 'xml' }, 'format'], [{ from: '5000', to: '4000' }, 'to']] as const) {
      expect(() => normaliseQuery(raw as any, ret)).toThrow(expect.objectContaining({ status: 400, error: 'invalid_args', extra: { details: { path } } }));
    }
  });
  it('range entirely before the window is range_out_of_retention', () => {
    expect(() => normaliseQuery({ from: '10', to: '20' }, ret)).toThrow(expect.objectContaining({ error: 'range_out_of_retention' }));
  });
  it('topicFilters builds four topic[0] filters for the resolved symbol', () => {
    const sym = xdr.ScVal.scvSymbol('transfer').toXDR('base64');
    expect(topicFilters('transfer')).toEqual([[sym], [sym, '*'], [sym, '*', '*'], [sym, '*', '*', '*']]);
    expect(normaliseQuery({ type: 'Transfer' }, ret).type).toBe('Transfer');
  });
});
```

`server/test/history/decode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { contract, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { decodeEvent, matchesAddress, resolveTopic } from '../../src/history/decode.js';
import { toCsv } from '../../src/history/csv.js';
import { loadFixtureWasm } from '../fixtures/index.js';
import { parseWasm } from '../../src/spec/model.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const spec = parseWasm(loadFixtureWasm());   // declares Pinged { prefix_topics: ['pinged'], who: topic_list, n: data, data_format: map }
const fakeSpec = (value: Record<string, unknown>) => ({ entries: [{ type: 'scSpecEntryEventV0', value }] }) as unknown as contract.Spec;
const b64 = (v: xdr.ScVal) => v.toXDR('base64');
const raw = (topic: xdr.ScVal[], value: xdr.ScVal) => ({ id: '0001-1', ledger: 100, closedAt: '2026-09-18T16:13:58Z', txHash: 'ab'.repeat(32), inSuccessfulContractCall: true, topic: topic.map(b64), value: b64(value) });
const pinged = () => raw([xdr.ScVal.scvSymbol('pinged'), nativeToScVal(G, { type: 'address' })], nativeToScVal({ n: 7 }, { type: { n: ['symbol', 'u32'] } }));

describe('resolveTopic', () => {
  it('maps a declared name or prefix topic to the on-chain symbol, else passes through', () => {
    expect(resolveTopic(spec, 'Pinged')).toBe('pinged'); expect(resolveTopic(spec, 'pinged')).toBe('pinged'); expect(resolveTopic(spec, 'PINGED')).toBe('pinged');
    expect(resolveTopic(spec, 'transfer')).toBe('transfer');
  });
});

describe('decodeEvent', () => {
  it('decodes topics and map-format data of a declared event', () => {
    const ev = decodeEvent(pinged(), spec, 'testnet');
    expect(ev).toMatchObject({ event: 'pinged', topics: ['pinged', G], data: { n: 7 }, successful: true, ledger: 100, tx_hash: 'ab'.repeat(32), explorer_url: `https://stellar.expert/explorer/testnet/tx/${'ab'.repeat(32)}` });
    expect(ev.raw.topic).toHaveLength(2);
  });
  it('names vec-format and single-value data from the spec params', () => {
    const vec = fakeSpec({ name: 'Swap', prefix_topics: ['swap'], params: [{ name: 'amount_in', location: 'data', type: 'i128' }, { name: 'amount_out', location: 'data', type: 'i128' }], data_format: 'vec' });
    expect(decodeEvent(raw([xdr.ScVal.scvSymbol('swap')], nativeToScVal([1n, 2n], { type: ['i128', 'i128'] })), vec, 'mainnet')).toMatchObject({ event: 'swap', data: { amount_in: '1', amount_out: '2' }, explorer_url: expect.stringContaining('/public/tx/') });
    const single = fakeSpec({ name: 'Minted', prefix_topics: ['minted'], params: [{ name: 'to', location: 'topic_list', type: 'address' }, { name: 'amount', location: 'data', type: 'i128' }], data_format: 'single_value' });
    expect(decodeEvent(raw([xdr.ScVal.scvSymbol('minted'), nativeToScVal(G, { type: 'address' })], nativeToScVal(5n, { type: 'i128' })), single, 'testnet').data).toEqual({ amount: '5' });
  });
  it('undeclared events decode generically; undecodable data gives null', () => {
    expect(decodeEvent(raw([xdr.ScVal.scvSymbol('burn')], nativeToScVal([1n, 2n], { type: ['i128', 'i128'] })), spec, 'testnet')).toMatchObject({ event: 'burn', data: ['1', '2'] });
    const bad = decodeEvent({ ...pinged(), value: 'not-xdr' }, spec, 'testnet');
    expect(bad.data).toBeNull(); expect(bad.event).toBe('pinged');
  });
  it('matchesAddress looks through topics and nested data', () => {
    const ev = decodeEvent(pinged(), spec, 'testnet');
    expect(matchesAddress(ev, G)).toBe(true); expect(matchesAddress(ev, 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H')).toBe(false);
  });
  it('toCsv escapes and JSON-encodes topics/data', () => {
    const csv = toCsv([decodeEvent(pinged(), spec, 'testnet')]);
    expect(csv.split('\n')[0]).toBe('id,ledger,closed_at,tx_hash,successful,event,topics,data');
    expect(csv.split('\n')[1]).toContain('"[""pinged"",""' + G + '""]"');
  });
});
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run test/history` → FAIL.

- [ ] **Step 3: Implement**

`server/src/history/query.ts`:

```ts
import { StrKey, xdr } from '@stellar/stellar-sdk';
import { badRequest } from '../errors.js';
import { rangeOutOfRetention } from '../chain/errors.js';
import type { Retention } from './types.js';

export const DEFAULT_WINDOW_LEDGERS = 17_280;   // ≈ 24 h at 5 s
export const LEDGER_SECONDS = 5.5;
export type Normalised = { type?: string; address?: string; fromLedger: number; toLedger: number; cursor?: string; limit: number; format: 'json' | 'csv' };
/** `type` is matched on topic[0]; the RPC needs one filter per topic count, so cover 1–4 topics with wildcards. */
export const topicFilters = (symbol: string): string[][] => { const s = xdr.ScVal.scvSymbol(symbol).toXDR('base64'); return [[s], [s, '*'], [s, '*', '*'], [s, '*', '*', '*']]; };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function toLedger(v: unknown, path: string, r: Retention): number {
  if (typeof v !== 'string' || v === '') throw badRequest('invalid_args', `${path} must be a ledger sequence or an ISO-8601 time`, { path });
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v); if (Number.isNaN(t)) throw badRequest('invalid_args', `${path} must be a ledger sequence or an ISO-8601 time`, { path });
  return r.latestLedger - Math.round((Date.parse(r.latestLedgerCloseTime) - t) / 1000 / LEDGER_SECONDS);
}
export function normaliseQuery(raw: Record<string, unknown>, r: Retention): Normalised {
  const limit = raw.limit === undefined ? 50 : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw badRequest('invalid_args', 'limit must be an integer between 1 and 200', { path: 'limit' });
  const format = raw.format === undefined ? 'json' : raw.format;
  if (format !== 'json' && format !== 'csv') throw badRequest('invalid_args', 'format must be json or csv', { path: 'format' });
  const address = raw.address === undefined ? undefined : String(raw.address);
  if (address !== undefined && !StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address)) throw badRequest('invalid_args', 'address must be a G… or C… address', { path: 'address' });
  const type = raw.type === undefined ? undefined : String(raw.type);
  if (type !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(type)) throw badRequest('invalid_args', 'type must be an event name (symbol)', { path: 'type' });
  const rawTo = raw.to === undefined ? r.latestLedger : toLedger(raw.to, 'to', r);
  const rawFrom = raw.from === undefined ? rawTo - DEFAULT_WINDOW_LEDGERS : toLedger(raw.from, 'from', r);
  if (rawFrom > rawTo) throw badRequest('invalid_args', 'to must not be before from', { path: 'to' });
  if (rawTo < r.oldestLedger) throw rangeOutOfRetention(r.oldestLedger, r.latestLedger);
  const fromLedger = clamp(rawFrom, r.oldestLedger, r.latestLedger), toLedger_ = clamp(rawTo, r.oldestLedger, r.latestLedger);
  return { type, address, fromLedger, toLedger: toLedger_, cursor: raw.cursor === undefined ? undefined : String(raw.cursor), limit, format };
}
```

`server/src/history/decode.ts`:

```ts
import { contract, scValToNative, xdr } from '@stellar/stellar-sdk';
import { toJson } from '../spec/codec.js';
import type { Network } from '../types.js';
import type { RawEvent } from './types.js';

export type DecodedEvent = { id: string; ledger: number; closed_at: string; tx_hash: string; successful: boolean; event: string | null; topics: unknown[]; data: unknown; raw: { topic: string[]; value: string }; explorer_url: string };

/** The JSON-ish shape contract.Spec exposes for `#[contractevent]` entries (same access pattern as spec/model.ts). */
type EventSpec = { name: string; prefix_topics: string[]; params: Array<{ name: string; location: 'topic_list' | 'data'; type: unknown }>; data_format: 'map' | 'vec' | 'single_value' };
const eventSpecs = (spec: contract.Spec): EventSpec[] =>
  (spec.entries as unknown as Array<{ type: string; value: EventSpec }>).filter((e) => e.type === 'scSpecEntryEventV0').map((e) => e.value);
const findEvent = (spec: contract.Spec, symbol: string) => { const k = symbol.toLowerCase(); return eventSpecs(spec).find((e) => e.name.toLowerCase() === k || (e.prefix_topics[0] ?? '').toLowerCase() === k); };

/** `type` as the user typed it (declared name `Pinged`, prefix topic `pinged`, any case) → the on-chain symbol; unknown names pass through unchanged. */
export const resolveTopic = (spec: contract.Spec, type: string): string => findEvent(spec, type)?.prefix_topics[0] ?? type;

const dec = (b64: string): unknown => toJson(scValToNative(xdr.ScVal.fromXDR(b64, 'base64')));
const safe = (f: () => unknown): { ok: true; v: unknown } | { ok: false } => { try { return { ok: true, v: f() }; } catch { return { ok: false }; } };

/** Topics decoded in order; data named by the declared event's `data` params for vec/single_value formats (map data is already keyed), else the plain decoded value, else null. */
export function decodeEvent(raw: RawEvent, spec: contract.Spec, network: Network): DecodedEvent {
  const topics = raw.topic.map((t) => { const r = safe(() => dec(t)); return r.ok ? r.v : null; });
  const event = typeof topics[0] === 'string' ? topics[0] : null;
  const value = safe(() => dec(raw.value));
  let data: unknown = value.ok ? value.v : null;
  const decl = event ? findEvent(spec, event) : undefined;
  if (decl && value.ok) {
    const dataParams = decl.params.filter((p) => p.location === 'data');
    if (decl.data_format === 'single_value' && dataParams.length === 1) data = { [dataParams[0].name]: value.v };
    else if (decl.data_format === 'vec' && Array.isArray(value.v) && value.v.length === dataParams.length) data = Object.fromEntries(dataParams.map((p, i) => [p.name, (value.v as unknown[])[i]]));
  }
  return { id: raw.id, ledger: raw.ledger, closed_at: raw.closedAt, tx_hash: raw.txHash, successful: raw.inSuccessfulContractCall, event, topics, data, raw: { topic: raw.topic, value: raw.value },
    explorer_url: `https://stellar.expert/explorer/${network === 'mainnet' ? 'public' : 'testnet'}/tx/${raw.txHash}` };
}
const contains = (v: unknown, needle: string): boolean => v === needle || (Array.isArray(v) ? v.some((x) => contains(x, needle)) : !!v && typeof v === 'object' && Object.values(v as object).some((x) => contains(x, needle)));
export const matchesAddress = (ev: DecodedEvent, address: string) => contains(ev.topics, address) || contains(ev.data, address);
```

`server/src/history/csv.ts`:

```ts
import type { DecodedEvent } from './decode.js';
const cell = (v: unknown) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const CSV_HEADER = 'id,ledger,closed_at,tx_hash,successful,event,topics,data';
export const toCsv = (events: DecodedEvent[]) => [CSV_HEADER, ...events.map((e) => [e.id, e.ledger, e.closed_at, e.tx_hash, e.successful, e.event ?? '', JSON.stringify(e.topics), JSON.stringify(e.data)].map(cell).join(','))].join('\n');
```

- [ ] **Step 4: Run** — `npx vitest run test/history && npm run typecheck` → PASS. (If `spec.entries` items are XDR objects rather than the `{ type, value }` JSON form in this SDK build, follow whatever `src/spec/model.ts` does to read `scSpecEntryEventV0` — it is the same access pattern.)
- [ ] **Step 5: Commit** — `git add server/src/history server/test/history && git commit -m "server: history query normalisation, event decoding, CSV" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 3: `HistoryService`, `GET /c/:id/events`, OpenAPI

**Files:**
- Create: `server/src/history/service.ts`, `server/test/helpers/fakeHistory.ts`, `server/test/history/service.test.ts`, `server/test/http/events.test.ts`
- Modify: `server/src/http/deps.ts` (`history: HistoryService`), `server/src/main.ts`, `server/test/helpers/app.ts`, `server/src/http/routes/docs.ts` (replace the 501), `server/src/docs/openapi.ts` (+ path), `server/test/docs/openapi.test.ts` (+ snapshot if any)

**Interfaces (produces):**
- `class HistoryService { constructor(source: HistorySource, registryReady: (id) => Promise<Ready>, opts?: { ttlMs?: number; max?: number }); query(id: string, raw: Record<string, unknown>): Promise<EventsResponse>; csv(id, raw): Promise<string> }` with `EventsResponse = { events: DecodedEvent[]; page: { cursor: string | null; limit: number; from_ledger: number; to_ledger: number }; retention: { oldest_ledger, latest_ledger, latest_ledger_close_time, note } }`.
- `FakeHistorySource` (test helper): `pages: EventPage[]` consumed in order, `calls` recorded, `retention` fixed `{ oldestLedger: 1000, latestLedger: 200000, latestLedgerCloseTime: '2026-09-19T00:00:00.000Z' }`.

- [ ] **Step 1: Failing tests** — `service.test.ts`: (a) `query` decodes a page and post-filters `address`; (b) identical queries within 10 s hit the source once (`calls.length === 1`), a different `limit` misses; (c) `page.from_ledger` shows the clamp. `events.test.ts` (via `testApp()`, `registerFixture()`, `t.historySource` = the FakeHistorySource injected by the helper): 200 shape with a `pinged` event decoded as `{ event: 'pinged', topics: ['pinged', OWNER], data: { n: 7 } }`; `?type=Pinged` (declared name, any case) passes the four `pinged` topic filters to the source; `?format=csv` → `text/csv` with the header; `?limit=0` → 400 `invalid_args` path `limit`; unknown id → 404; a queued contract → 409; `?from=10&to=20` → 400 `range_out_of_retention`; source throwing `rpcUnavailable` → 502.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** — `service.ts` composes `registryReady(id)` → `normaliseQuery` → `topics = q.type ? topicFiltersFor(spec, q.type) : undefined` → cache lookup (key `JSON.stringify([id, network, fromLedger, toLedger, topics, cursor, limit])`, Map-based LRU: delete+set on hit, evict oldest past `max`) → `source.events(...)` → `decodeEvent(raw, spec, network)` each → `matchesAddress` filter → response. `query(id, raw)` and `csv(id, raw)` share one private `run(id, raw)`. `docs.ts`: `app.get('/c/:id/events', async (req, reply) => { const q = req.query as Record<string, unknown>; if (q.format === 'csv') return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${req.params.id}-events.csv"`).send(await deps.history.csv(req.params.id, q)); return deps.history.query(req.params.id, q); })`. `openapi.ts`: add `/c/{id}/events` GET with the query parameters and a `200` response schema (keep it brief: object with `events` array of objects, `page`, `retention`). `main.ts`: `const history = new HistoryService(new RpcHistorySource(cfg), (id) => registry.ready(id))`; `test/helpers/app.ts`: `new HistoryService(new FakeHistorySource(), (id) => registry.ready(id), { ttlMs: 10_000 })` and return `history` + the fake as `historySource`.
- [ ] **Step 4: Run** — `npm test && npm run typecheck` → PASS (update the docs.test `events is 501` expectation: it is gone).
- [ ] **Step 5: Commit** — `server: GET /c/:id/events over the history service`.

---

### Task 4: MCP `get_events`, llms.txt, README, e2e

**Files:**
- Modify: `server/src/mcp/handlers.ts` (`getEvents(deps, r, args)` → `deps.history.query(r.model.id, args)`), `server/src/mcp/tools.ts` (`get_events`), `server/src/mcp/global.ts` (`get_events({ id, … })`), `server/src/docs/llms.ts` (+ line, snapshot), `server/README.md`, `server/test/mcp/tools.test.ts` (counts: ro `N+3`, rw `2N+4`; a `get_events` call test with the fake source), `server/test/mcp/global.test.ts` (nine tools; `get_events` case), `server/test/e2e/flow.test.ts`

- [ ] **Step 1:** tests first (counts + calls), see them fail.
- [ ] **Step 2:** implement; tool input schema for `get_events`: `{ type?: string, address?: string, from?: string, to?: string, cursor?: string, limit?: integer }` (+ `id` on the global server), output schema = `{ events: array, page: object, retention: object }`; description: `Decoded contract events from the network RPC (last ~7 days). Filters: type (event name), address (in topics/data), from/to (ledger or ISO time), cursor, limit ≤ 200.`
- [ ] **Step 3:** llms.txt Endpoints: `GET  ${base}/events?type=&address=&from=&to=&limit=   decoded events, last ~7 days`; README: endpoint row + query table + note on retention/post-filtering; e2e: after the existing submit test, `GET /c/${ID}/events?type=pinged&from=<ledger-200>` returns ≥1 event whose `tx_hash` equals the submitted hash and `event === 'pinged'`; MCP `get_events` (per-contract) returns the same id.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run test:e2e` → PASS. Commit `server: MCP get_events, docs and e2e for history`.

---

### Task 5: site — live History tab

**Files:**
- Modify: `lib/api.js` (`contracts.events(id, params, o)` → `/c/:id/events?<qs>`; `contracts.eventsCsvUrl(id, params)`; `mcpToolCount` → `N+3` / `2N+4`), `components/workspace/History.jsx` (rewrite), `components/workspace/Overview.jsx` (History row live: `decoded events · last ~7 days`, no `soon`), `components/docs-data.js` (api page: `GET /c/{id}/events` row + query kv; mcp page: `get_events` row), `test/site/history.test.jsx` (rewrite), `test/site/api.test.js` (+ events URL/qs test, count test), `e2e/site.spec.ts` (History: banner text `covers the last ~7 days` and either a row or `No events in this window.`; MCP count `n * 2 + 4`), `README.md` (notes)
- `History.jsx` (client): state `type` (`all` + declared event names from `contract.events`), `address`, `from`/`to` (`datetime-local`, default last 24 h), `rows`, `cursor`, `retention`; `useApi` for the first page keyed on the filters; `Load more` appends via `cursor`; table columns Time (`relTime(closed_at)`, `title` = exact), Event, Decoded (`event(name=value, …)` from `data`; raw JSON toggle per row), Ledger, Tx (short hash → `explorer_url`), Status chip; tiles `Events (loaded)`, `Event types`, `Addresses (loaded)`; banner `History comes from the network's RPC and covers the last ~7 days (ledgers <oldest>–<latest>).`; empty `No events in this window.`; `Download CSV` opens `contracts.eventsCsvUrl(id, { ...filters, limit: 200 })` in a new tab (`window.open`), `Download JSON` uses `download()` on the loaded rows. `S` stub in tests needs `Segmented`, `Field`, `Button`, `Chip`, `Numeral`, `Stat`, `DataTable: () => null`; mock `@/lib/api`'s `contracts.events` to resolve a two-event page.
- [ ] Run `npm test && npm run build` → PASS. Commit `site: live History tab over /events`.

---

### Task 6: ship

- PR `m5-history` → `main`, CI, merge; Dokploy autodeploys the API; Vercel deploys the site from `main`.
- Smoke: `curl "https://api.sonata.brages.uk/c/CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH/events?limit=3"` → three decoded Soroswap events with `explorer_url`; `…?type=swap_exact_tokens_for_tokens` (or whatever `event` names appear) filters; `format=csv` downloads. Production Playwright run.

---

## Self-review

- Spec coverage: §3 source → T1; §4 decoding → T2; §5 REST (query, response, CSV, cache, errors) → T2–T3; §6 MCP + llms → T4; §7 site → T5; §8 edge cases → T2 (clamps, out-of-retention) + T3 (post-filter/cursor); §9 tests → each task; §10 → T6.
- Placeholders: Task 3/5 give shapes and behaviour in prose where the code is a straightforward composition of Task 1–2 modules and existing site patterns (`useApi`, `ResponsiveTable`, `download`); every string that matters is exact.
- Consistency: `Retention`/`EventQuery`/`RawEvent`/`EventPage` (T1) feed `normaliseQuery`/`decodeEvent` (T2) and `HistoryService` (T3); `deps.history.query(id, raw)` is what T4's MCP handler and T3's route call; `mcpToolCount` and the tool counts move together in T4/T5.
