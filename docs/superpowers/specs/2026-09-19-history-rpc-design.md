# M5 — History v1: decoded contract events over RPC (design)

**Status:** approved in conversation on 2026-09-19 (user: "v1 için RPC diyelim sadece" — RPC `getEvents` only, events only, no ingestion into our DB; provider interface for Mercury/Hubble later). Builds on M1/M3/M4 specs. Branch `m5-history`.

## 1. Goal

`GET /c/:id/events` stops being a 501: it returns the contract's **decoded events** for a ledger/time window, read on demand from the network's RPC (`getEvents`), filtered by event type / address / range, paged by cursor. The same data powers an MCP `get_events` tool (per-contract server and global server) and a live History tab on the site with CSV/JSON export. Nothing is stored; the only state is a short in-process cache.

Non-goals (v1): transactions/calls history, address activity across contracts, stats over more than the retention window, ingestion or backfill, Mercury/Hubble adapters (the interface is designed for them), webhooks.

## 2. Facts that shape the design (measured 2026-09-19)

- Public RPCs keep exactly **120 960 ledgers ≈ 7 days** of events on both networks (`mainnet.sorobanrpc.com`, `soroban-rpc.mainnet.stellar.gateway.fm`, `soroban-testnet.stellar.org`): `getEvents` with an older `startLedger` fails with `startLedger must be within the ledger range: <oldest> - <latest>`; the response carries `oldestLedger`, `latestLedger`, `latestLedgerCloseTime` and a `cursor`.
- Each event: `{ type: 'contract', ledger, ledgerClosedAt, contractId, id, operationIndex, transactionIndex, txHash, inSuccessfulContractCall, topic: base64 ScVal[], value: base64 ScVal }`. `topic[0]` is the event name (`ScSymbol`) for spec-declared events.
- The SEP-48 model already lists a contract's events with their parameter names and types (`ContractModel.events[]`), and `spec/codec.ts` decodes any `ScVal` into our JSON contract (`scValToJson`-style decode used by `decodeResult`). Soroban event conventions: topics = `[name, ...indexed params]`, data = either a single value or a tuple/map of the remaining params.

## 3. `HistorySource` interface (server)

```ts
type EventQuery = { contractId: string; network: Network; startLedger: number; endLedger?: number; topics?: (string | '*')[][]; cursor?: string; limit: number };
type RawEvent = { id: string; ledger: number; closedAt: string; txHash: string; inSuccessfulContractCall: boolean; topic: string[]; value: string };   // base64 XDR
type EventPage = { events: RawEvent[]; cursor: string | null; oldestLedger: number; latestLedger: number; latestLedgerCloseTime: string };
interface HistorySource { name: string; retention(network): Promise<{ oldestLedger: number; latestLedger: number; latestLedgerCloseTime: string }>; events(q: EventQuery): Promise<EventPage>; }
```

`RpcHistorySource` (v1) implements it with `rpc.Server.getEvents` (`filters: [{ type: 'contract', contractIds: [id], topics }]`, `pagination: { limit, cursor }`); `retention()` = `getLatestLedger` + one cheap `getEvents(limit 1)` to read `oldestLedger`, cached 60 s per network. Errors map to the existing `ChainError`s (`rpc_unavailable` 502); a `startLedger` outside the window becomes `400 range_out_of_retention` with `details: { oldest_ledger, latest_ledger }`.

## 4. Decoding

`src/history/decode.ts` turns a `RawEvent` + `ContractModel`/`Spec` into:

```json
{ "id": "0276993418856112128-0000000001", "ledger": 64497433, "closed_at": "2026-09-18T16:13:58Z", "tx_hash": "…", "successful": true,
  "event": "swap", "topics": ["swap", "GBX7…"], "data": { "amount_in": "100000000", "amount_out": "19149008" }, "raw": { "topic": ["AAAADw…"], "value": "AAAA…" } }
```

- `event`: decoded `topic[0]` when it is a symbol/string, else `null`; `topics`: every topic decoded with the generic ScVal→JSON decoder (addresses become strings).
- `data`: if the contract's spec declares an event with that name, the decoded value is **named** — a tuple/vector maps positionally onto the non-topic params, a single value onto the single remaining param, a map is passed through; otherwise `data` is the plain decoded value. Decoding never throws: on failure `data` is `null` and `raw` is always present.
- Explorer link: `explorer_url` = `https://stellar.expert/explorer/{public|testnet}/tx/<tx_hash>`.

## 5. REST

`GET /c/:id/events` (public, contract must be `ready`):

| Query | Meaning |
|---|---|
| `type` | event name; becomes a `topics` filter `[[<symbol xdr>, '*', '*', '*']]` on topic[0] |
| `address` | G…/C… address; if it appears in the decoded topics or data the event matches; applied **after** decoding within the fetched page (documented: only the fetched window is scanned) |
| `from`, `to` | ledger sequence (integer) **or** ISO-8601 time; times are converted to ledgers with `latestLedger` and the ~5.3 s average close time (`Math.floor`), clamped to the retention window; defaults: `to` = latest, `from` = max(oldest, latest − 17 280 ≈ 24 h) |
| `cursor` | opaque, from the previous page |
| `limit` | 1–200, default 50 (RPC is called with the same limit; post-filters may return fewer rows — `next` cursor still advances) |
| `format` | `json` (default) or `csv` (`text/csv`, columns `id,ledger,closed_at,tx_hash,successful,event,topics,data`; `topics`/`data` JSON-encoded) |

Response `200 { events: [...], page: { cursor, limit, from_ledger, to_ledger }, retention: { oldest_ledger, latest_ledger, latest_ledger_close_time, note: 'RPC history covers the last ~7 days' } }`. Errors: `404 contract_not_found`, `409 contract_not_ready`, `400 invalid_args` (bad type/address/range/limit), `400 range_out_of_retention`, `502 rpc_unavailable`. Rate limit: the default 120/min. Cache: an in-process LRU keyed by the full RPC query (id, network, startLedger, endLedger, topics, cursor, limit) with a **10 s TTL**, so the site's polling and an agent's retries don't hammer the free RPC.

## 6. MCP

- Per-contract server (`/c/:id/mcp`): tool `get_events({ type?, address?, from?, to?, cursor?, limit? })` → the REST body (structured + text). Counted in the tool totals (`N+3` ro / `2N+4` rw — the site's `mcpToolCount` and the tests that assert `Tools · N enabled` move with it).
- Global server (`/mcp`): tool `get_events({ id, …same })`. Both go through one handler in `mcp/handlers.ts`.
- llms.txt: the Endpoints block gains `GET ${base}/events?type=&address=&from=&to=&limit= (decoded events, last ~7 days)`; the "## Events" section already lists declared events.

## 7. Site — History tab (live)

- Filters: event type (`Segmented`: All + the contract's declared event names; free text if the spec declares none), address (`Field`), range (`From`/`To` ISO datetime-local inputs, default last 24 h), `Load more` (cursor).
- Table (ResponsiveTable): Time (`relTime` + exact on hover), Event, Decoded (`name(param=value, …)` compact string; expandable raw JSON), Ledger, Tx (short hash linking to Stellar Expert), Status chip (success/failed call).
- Stats tiles are honest and window-scoped: `Events (loaded)`, `Event types`, `Unique addresses (in loaded rows)`, and the window label; no volume tile (needs token semantics).
- Export: `Download CSV` (uses `format=csv` for the current filters, first page up to `limit=200`) and `Download JSON` (loaded rows).
- A banner line: `History comes from the network's RPC and covers the last ~7 days (ledgers <oldest>–<latest>).` Empty state: `No events in this window.` with a hint to widen the range.
- Overview: the History row becomes live (`decoded events · last 7 days`), no `soon` chip.

## 8. Errors and edge cases

- Contract with no declared events: everything still works (`event` from topic[0], `data` plain).
- `address` filter: because it is post-filter, a page may come back with 0 rows and a `cursor` — the UI keeps paging while the user asks for more; the API documents this.
- Retention edge: `from` older than `oldest_ledger` is **clamped** (not rejected) and the response `page.from_ledger` shows the clamp; only an explicit ledger *both* older than the window *and* with `to` also older → `400 range_out_of_retention`.
- RPC returning `latestLedger` < requested `to` (lag): `to` is clamped to `latestLedger`.

## 9. Testing

- Unit: `decode.ts` on fixture XDR (a topic symbol + i128 data; a tuple mapped onto declared params; an address topic; an undecodable value → `data: null`); query normalisation (times→ledgers, clamps, limit bounds, `type`→topics XDR); CSV serialisation.
- Route (FakeHistorySource): 501 gone; paging; `type`/`address`/`from`/`to`/`limit`/`format` behaviours; error codes; cache hit (second identical call doesn't hit the source).
- MCP: per-contract and global `get_events` (tools/list counts updated; a call returns the decoded page); `tools.test.ts` counts move from N+2 to N+3.
- Server e2e (testnet): after the fixture's `ping`/`bump` submit, `GET /c/:id/events?from=<recent>` returns ≥1 event with `event: 'pinged'` (the fixture emits `Pinged`) and `tx_hash` equal to the submitted hash; MCP `get_events` returns the same.
- Site unit: History renders rows from a mocked `contracts.events()`, applies the type filter client-side label, shows the retention banner; export builds a CSV URL with the filters. Playwright: the History tab shows the banner text and the table/empty state (no fake rows).

## 10. Deployment

No env, no migration. RPC load is bounded by the 10 s cache and the 120/min limiter; if the free RPC rate-limits `getEvents`, switch `RPC_URL_*` to a keyed free tier (one env var). Mercury/Hubble land as additional `HistorySource` implementations selected per network by env (`HISTORY_SOURCE_MAINNET=rpc|mercury|hubble`), unchanged REST/MCP/site.
