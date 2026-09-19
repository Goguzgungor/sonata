# Sonata server

## What this is

Sonata server turns any deployed Soroban contract into a REST API, a per-contract MCP server, and generated docs (`llms.txt`, OpenAPI). It reads the contract's WASM spec, exposes each function as an HTTP endpoint (simulate, build unsigned tx, submit, poll), and tracks registered contracts in Postgres.

## Run locally

```bash
docker compose up -d db
cp .env.example .env
npm i
npm run dev
```

`npm run dev` reads `.env` automatically (via Node's `--env-file-if-exists` flag) and restarts on file changes. The API listens on `http://localhost:8080`.

## Endpoints

Base URL `PUBLIC_BASE_URL` (prod: `https://api.sonata.brages.uk`). JSON everywhere except `llms.txt`.

| Method / path | Purpose | Success |
|---|---|---|
| `POST /auth/challenge` `{address, network}` | SEP-10 challenge to sign | `200 {transaction, network_passphrase}` |
| `POST /auth/token` `{transaction, network}` | Verify the signed challenge, issue a session | `200 {token, address, expires_at}` |
| `GET /auth/me` | Whoami for the bearer token | `200 {address, expires_at}` |
| `POST /contracts` `{id, network, name?}` | Register / re-check — session required (owner) | `202 {id, network, status, steps}` |
| `GET /contracts` `?owner=me` | Registered list, or just the caller's (`?owner=me` needs a session) | `200 [{id, name, network, status, fns, owner, created_at, updated_at}]` |
| `GET /c/:id` | Model + settings | `200 {…ContractModel (sac? true for a Stellar Asset Contract), mcp_scope, status, urls: {mcp, llms, openapi, explorer}}` |
| `GET /c/:id/status` | Pipeline steps | `200 {status, steps, error?}` |
| `PATCH /c/:id` `{name?, mcp_scope?}` | Settings — session required (owner) | `200 {…same as GET}` |
| `POST /c/:id/call/:fn` `{args, source?, network?}` | Simulate any function | `200 {result, simulated: true, latency_ms, ledger, auth: string[]}` |
| `POST /c/:id/tx/:fn` `{args, source, fee?, timeout_s?, network?}` | Unsigned XDR | `200 {xdr, fee, auth: string[], ledger, expires_at}` |
| `POST /c/:id/submit` `{xdr}` | Relay signed tx, wait ≤ 30 s | `200 {hash, status: 'success'\|'failed'\|'pending', ledger?, fee_charged?, return_value?, result_xdr?}` |
| `GET /tx/:hash?network=` | Poll a submit | same shape |
| `GET /c/:id/llms.txt` | AI docs | `text/markdown` |
| `GET /c/:id/openapi.json` | Per-contract OpenAPI 3.1 | JSON |
| `GET /c/:id/events` `?type&address&from&to&cursor&limit&format` | Decoded events from the network RPC (last ~7 days) | `200 {events: [{id, ledger, closed_at, tx_hash, successful, event, topics, data, raw, explorer_url}], page: {cursor, limit, from_ledger, to_ledger}, retention: {oldest_ledger, latest_ledger, latest_ledger_close_time, note}}` — `format=csv` streams CSV |
| `GET /healthz` | Liveness | `200 {db: 'ok', networks: {testnet: 'ok'}}` |
| `ALL /mcp` | Global MCP (all contracts) | Streamable HTTP |

`return_value` is the invocation's returned ScVal (base64), present on success only; `result_xdr` is the whole `TransactionResult` (base64), present on success and failure. A submit is never retried, and `DUPLICATE` / `TRY_AGAIN_LATER` from the RPC are reported as `pending` (then polled), not as an error — only `ERROR` is `422 submit_rejected`. Stellar Asset Contracts (classic assets such as XLM or USDC) have no WASM; they register from the built-in SEP-41 token spec and expose `balance`, `transfer`, `approve`, … like any other contract (`sac: true` in `GET /c/:id`).

**Ownership.** `POST /contracts` and `PATCH /c/:id` require a session: the wallet signs a SEP-10 challenge from `POST /auth/challenge`, submits it to `POST /auth/token`, and gets back a 24 h bearer token to send as `Authorization: Bearer <token>`. The first wallet to register a contract owns it; rows registered before this release have no owner and are claimed by the first wallet that registers or patches them.

The `auth_secret` (JWT signing key) and `auth_signing_seed` (SEP-10 challenge signer) are self-generated on first boot and persisted in the `settings` table via an insert-only write, so multiple instances cold-booting at once converge on the same pair instead of each minting its own. The signed-challenge replay guard (`ChallengeVerifier`'s `used` set in `src/auth/challenge.ts`), however, is an in-memory `Map` kept per process, not shared through the store. With a single instance a signed challenge can be redeemed for a token exactly once; with more than one instance behind a load balancer, a leaked signed challenge could be replayed once per instance until that replay set moves to a shared store (Postgres or Redis) — worth keeping in mind before scaling this service horizontally.

`healthz` is a liveness probe for this process: it answers `503` only when the database does not answer a `select 1`. `networks` lists just the configured networks (`ok`/`error` per network, an unconfigured one omitted entirely) — a degraded RPC is reported there but still answers `200`, so the platform does not recycle an otherwise healthy instance.

**History.** Events are read on demand from the network RPC's `getEvents` — nothing is stored. The window is whatever the RPC retains (~7 days on public nodes), exposed per-request in `retention`. `from`/`to` accept a ledger sequence or an ISO-8601 time and are clamped to the retained window. `type` matches the declared event name (`Pinged`) or the on-chain symbol (`pinged`), case-insensitively. `address` is matched after decoding, within the fetched page — so a page can come back with fewer than `limit` rows and a `cursor` to keep paging. Asking for a range entirely older than the window is `400 range_out_of_retention` with `details.oldest_ledger`/`latest_ledger`.

## MCP

One global MCP server over Streamable HTTP covers every registered contract, on any network:

```json
{"mcpServers":{"sonata":{"url":"https://api.sonata.brages.uk/mcp","type":"http"}}}
```

```bash
claude mcp add --transport http sonata https://api.sonata.brages.uk/mcp
```

| Tool | Input | Output | Notes |
|---|---|---|---|
| `list_contracts` | `{ network?: 'testnet'|'mainnet', q?: string, include_pending?: boolean }` | `{ contracts: [{ id, name, network, status, fns, sac, owner, updated_at }] }` | Ready rows only unless `include_pending`; `q` is a case-insensitive substring on name or id; sorted by `updated_at` desc; capped at 200 |
| `get_contract` | `{ id }` | `{ id, name, network, sac, mcp_scope, owner, functions: [{ name, signature, doc, kind, input_schema }], types, errors, events, urls }` | The public row minus pipeline steps, with `input_schema` = the function's JSON schema (the same one `call`/`build` validate against) |
| `search_functions` | `{ id, query }` | `{ functions: [{ name, signature, doc, kind }] }` | Same semantics as the per-contract tool |
| `get_docs` | `{ id }` | `{ text }` | llms.txt |
| `get_events` | `{ id, type?, address?, from?, to?, cursor?, limit? }` | `{ events, page, retention }` | Same filters and shape as `GET /c/:id/events` (JSON only; no `format`) |
| `call` | `{ id, fn, args?, source? }` | `{ result, simulated: true, latency_ms, ledger, auth }` | Simulation; `source` optional (defaults to the configured sim account); learns read/write hints exactly like REST |
| `build` | `{ id, fn, args?, source, fee?, timeout_s? }` | `{ xdr, fee, auth, ledger, expires_at }` | **Only if the contract's `mcp_scope` is `rw`**; otherwise `isError` `{ error: 'write_tools_disabled', message: 'the owner of <id> has not enabled write tools; ask them to switch the MCP scope to read + write' }` |
| `submit` | `{ id, xdr }` | `{ hash, status, ledger?, fee_charged?, return_value?, result_xdr? }` | Same `rw` gate; waits ≤ 30 s. `id` selects the network and the write gate; the envelope itself is any signed transaction on that network. |
| `get_tx` | `{ hash, network }` | same as `submit` | Poll a pending submit |

`build` and `submit` only work for a contract whose owner has switched its MCP scope to read + write (`PATCH /c/:id {mcp_scope: 'rw'}`); every other tool works regardless of scope.

### Per-contract endpoint

Each registered contract also exposes its own scoped MCP server:

```bash
claude mcp add --transport http sonata-<name> https://api.sonata.brages.uk/c/<id>/mcp
```

It exposes `call_<fn>` for every function (`build_<fn>` and `submit_transaction` too, in `rw` scope), plus `search_functions`, `get_docs` and `get_events` (same input as the global tool, minus `id`) in both scopes.

## Tests

```bash
npm test
```

`npm run test:e2e` runs against real testnet infrastructure and needs `E2E_CONTRACT_ID` and `E2E_SECRET_KEY` in `.env.test`.

## Deploy

Manual, one-time setup on Fly.io:

```bash
cd server
fly launch --no-deploy --copy-config --name sonata-api
fly postgres create --name sonata-db --region ams
fly postgres attach sonata-db
fly secrets set SIM_SOURCE_ACCOUNT=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF
fly deploy
fly certs add api.sonata.brages.uk
```

Then add the CNAME shown by `fly certs show`. Verify with `curl https://api.sonata.brages.uk/healthz` → `{"db":"ok",...}`.

## Layout

```
server/
  package.json  tsconfig.json  vitest.config.ts  drizzle.config.ts  .env.example  README.md
  Dockerfile  docker-compose.yml  fly.toml
  src/
    config.ts                 env → Config
    types.ts                  ContractModel, JsonSchema, Network, Deps (shared types only)
    errors.ts                 ApiError class + helpers (one place for the envelope)
    spec/
      render.ts               renderType(typeDef) → "Vec<Address>" etc.
      hints.ts                classifyByName(fn, inputs) → 'read'|'write'|'unknown'
      schema.ts               inlineRefs(jsonSchema) + fnInputSchema(spec, fn)
      model.ts                modelFromWasm(wasm, meta) → ContractModel (+ keeps Spec)
      codec.ts                encodeArgs / decodeResult / errorName + JSON normalizers
    chain/
      types.ts                Chain interface (what everything else calls)
      rpc.ts                  RpcChain: real implementation over stellar-sdk
      errors.ts               parseSimulationError(msg) → { kind, code? }
      auth.ts                 authAddresses(entries, source) → string[]
    registry/
      schema.ts               drizzle tables
      store.ts                Store interface + PgStore + MemoryStore
      pipeline.ts             register(id, network, name?) with steps
      registry.ts             Registry = store + LRU + pipeline + spec cache
      hints-policy.ts         learnKind(deps, model, fn, observed, log): the monotonic read→write hint rule, shared by REST and MCP
    docs/
      llms.ts                 llmsTxt(model, cfg)
      openapi.ts              openapi(model, cfg)
    history/
      types.ts                HistorySource interface + EventQuery/EventPage/RawEvent/Retention
      rpc.ts                  RpcHistorySource: HistorySource over the network RPC's getEvents
      query.ts                normaliseQuery(raw, retention): type/address/from/to/cursor/limit, clamped to the window
      decode.ts               decodeEvent(raw, spec, network) via the SDK's SEP-48 event API; topic filters; address matching
      csv.ts                  toCsv(events) for ?format=csv
      service.ts              HistoryService: registryReady → normaliseQuery → source.events → decodeEvent, with a small LRU cache
    auth/
      challenge.ts            SEP-10-style challenge build + verify
      jwt.ts                  session token issue/verify
      keys.ts                 self-generated auth_secret / auth_signing_seed, persisted via the store
    http/
      app.ts                  buildApp(deps) → Fastify instance
      routes/auth.ts          /auth/challenge, /auth/token, /auth/me
      routes/contracts.ts     POST/GET /contracts, GET /c/:id, /status, PATCH
      routes/invoke.ts        /call, /tx, /submit, /tx/:hash
      routes/docs.ts          /llms.txt, /openapi.json, /events
      routes/health.ts        /healthz
    mcp/
      handlers.ts             shared tool logic (simulate, buildTx, submitTx, …) used by both MCP servers
      tools.ts                buildMcpServer(model, scope, deps) → McpServer (per-contract)
      global.ts               buildGlobalMcpServer(deps) → McpServer (every contract, id as an argument)
      route.ts                Fastify handler using NodeStreamableHTTPServerTransport
    main.ts                   boot
  drizzle/                    generated SQL migrations
  test/
    fixtures/kitchen-sink/    Cargo.toml, src/lib.rs, kitchen_sink.wasm
    helpers/fakeChain.ts      scripted Chain for route + mcp tests
    helpers/fakeHistory.ts    scripted HistorySource for route + mcp tests
    spec/*.test.ts  chain/*.test.ts  registry/*.test.ts  docs/*.test.ts  http/*.test.ts  mcp/*.test.ts  history/*.test.ts
    e2e/flow.test.ts          testnet
```
