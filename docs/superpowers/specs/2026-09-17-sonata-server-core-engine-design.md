# Sonata server — core engine (Milestone 1) design

**Date:** 2026-09-17
**Status:** approved in brainstorming, ready for implementation plan
**Scope:** the first real server for Sonata: register any Soroban contract, then serve a REST API (simulate + unsigned XDR + submit), a per-contract MCP server, and generated docs (llms.txt, OpenAPI). No auth, no history indexer, no flows, no explorer, no site wiring — those are later milestones.

## 1. Goals and non-goals

**Goals**
- Register a contract by ID + network; the pipeline fetches WASM, parses the SEP-48 spec, generates docs and MCP tools, persists the result.
- Once registered, **every** function in the spec can be simulated (`/call`) and built into an unsigned transaction (`/tx`). A signed XDR can be relayed (`/submit`).
- Every contract gets an MCP endpoint over Streamable HTTP with tools derived from the spec; write tools are gated by a per-contract scope.
- Response and error shapes match what the preview site's docs already promise.

**Non-goals (M1)**
- Authentication / API keys / plans / usage.
- Event history and indexing (`/events` returns `501 not_indexed`).
- Flows (`/flows/*`), explorer catalogue, verification.
- Changes to the Next.js site (M2 wires the site to this API).

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Language / runtime | TypeScript on Node 22 | `@stellar/stellar-sdk` `contract.Spec` already does WASM→spec, JSON→ScVal, ScVal→JSON and JSON Schema per function; `@modelcontextprotocol/sdk` is the reference MCP implementation with Streamable HTTP; same language as the site. |
| HTTP framework | Fastify | Fast, schema-first, `inject()` for route tests. |
| Persistence | Postgres 16 via `drizzle-orm` + `pg` | Registered contracts must survive restarts; drizzle keeps the schema in code. |
| Hosting | Long-running container on Fly.io + Fly Postgres | MCP Streamable HTTP, in-process caches and a future indexer all want a long-lived process. |
| Repo layout | `server/` inside this repo, own `package.json`, Dockerfile, `fly.toml` | One history with the site; **not** `api/` because Vercel treats a root `api/` folder as serverless functions. |
| Networks | `testnet` (public RPC by default) and `mainnet` (enabled only when `RPC_URL_MAINNET` is set) | Mainnet needs a paid RPC provider; config, not code. |
| Contract identity | `contracts.id` is the primary key; `network` is a column | A Soroban contract ID hashes the network passphrase, so one ID cannot exist on two networks. |
| Read/write classification | A stored *hint*, never a security boundary | SEP-48 does not mark functions read-only. The real distinction is which endpoint the caller uses (`/call` simulates, `/tx` builds XDR). |
| MCP transport | Stateless Streamable HTTP (no session IDs) | Works with `claude mcp add --transport http`, Cursor, Codex; survives restarts and load balancers with no coordination. |
| Read-only MCP scope | Write tools are **not listed** | Agents should not see tools they cannot use. The workspace's On/Off table is rendered from `GET /c/:id`, not from `tools/list`. |

## 3. Architecture

One Node process. Modules are directories with one job each; `ContractModel` is the only shared type.

```
server/
  src/
    config.ts     env → typed config
    chain/        RPC client per network: getContractWasm, simulate, getAccount,
                  sendTransaction, getTransaction, getHealth. Thin wrapper over
                  stellar-sdk rpc.Server. No business logic.
    spec/         WASM → SEP-48 entries → ContractModel. Owns read/write hints,
                  JSON⇄ScVal codec (contract.Spec), JSON Schema per function,
                  signature rendering, contract-error name lookup.
    registry/     Registration pipeline + Postgres store + in-process LRU of
                  ContractModel. Step status persisted for polling.
    http/         Fastify app + routes. Validates input (zod), calls
                  spec/chain/registry, shapes responses and errors.
    mcp/          Builds one McpServer per ContractModel; Streamable HTTP
                  transport at /c/:id/mcp; scope gating; per-contract cache.
    docs/         Pure: ContractModel → llms.txt string; ContractModel → OpenAPI 3.1.
    main.ts       boot: config → migrations → fastify.listen
  test/
    fixtures/     kitchen-sink contract (Rust source + built WASM)
    unit + route tests (vitest), e2e (testnet, opt-in)
  drizzle/        migrations
  Dockerfile, docker-compose.yml, fly.toml
```

### 3.1 ContractModel

```ts
type ContractModel = {
  id: string;                 // C…
  network: 'testnet' | 'mainnet';
  name: string | null;        // user-supplied or from spec meta
  wasmHash: string;
  specLedger: number;         // ledger the spec was read at
  functions: Array<{
    name: string;
    doc: string;
    inputs: Array<{ name: string; type: string }>;   // rendered type, e.g. "i128", "Vec<Address>"
    output: string;                                   // rendered, "void" if none
    kind: 'read' | 'write' | 'unknown';               // hint, see 3.2
    jsonSchema: JsonSchema;                           // inputs object schema
    outputSchema: JsonSchema | null;
  }>;
  types: Array<{ name: string; kind: 'struct' | 'union' | 'enum'; doc: string; jsonSchema: JsonSchema }>;
  errors: Array<{ code: number; name: string; doc: string }>;
  events: Array<{ name: string; doc: string; params: Array<{ name: string; type: string }> }>;
};
```

### 3.2 Read/write hint

- `read` if the function name matches a conservative list (`get_*`, `balance`, `allowance`, `total_supply`, `decimals`, `name`, `symbol`, `*_of`, `is_*`, `has_*`, `query_*`) **or** a previous simulation of it returned no auth entries and an empty read-write footprint.
- `write` if any input is an `Address` named `from`, `admin`, `owner`, `sender`, `caller` **or** a previous simulation required auth.
- else `unknown`; the UI shows it as write and MCP puts `build_*` behind the write gate (fail closed).

Learned hints are stored in `fn_hints` after any `/call` and survive spec re-parses.

### 3.3 Request flow

`POST /c/:id/call/balance` → `http` loads `ContractModel` (`registry` LRU → Postgres) → `spec.encodeArgs(fn, body.args)` → `chain.simulate(network, id, fn, scVals, source)` → `spec.decodeResult(fn, retval)` → JSON. `/tx/` shares the path until the end, where it `assembleTransaction(...).build().toXDR()` instead of decoding.

## 4. Registration pipeline

`POST /contracts {id, network, name?}` validates the ID (StrKey contract address), upserts a `queued` row and returns `202` immediately. A `p-queue` (concurrency 2) runs:

| Step | Does | Detail stored |
|---|---|---|
| 1 `fetch` | `chain.getContractWasm(id)` → bytes, `wasmHash`, ledger | `Ledger N · X KB` |
| 2 `parse` | `spec.fromWasm(wasm)` → `ContractModel` | `N functions · N types · N errors` |
| 3 `generate` | `docs.llmsTxt`, `docs.openapi`, MCP tool count | `OpenAPI 3.1 · N MCP tools` |
| 4 `index` | stub in M1 | status `skipped` |

**Idempotence.** Registering an existing ID re-fetches the on-chain `wasmHash`; if unchanged, returns the existing row without re-running; if changed (contract upgraded), re-runs steps 2–3 and refreshes docs. This is also the mechanism for "docs regenerate when the spec changes".

**Failure.** Each step writes its status before the next starts. Any throw marks that step and the contract `failed` with a human-readable `error` (e.g. `No contract spec found in WASM — was it built with soroban-sdk ≥ 20?`). Re-`POST` retries from step 1.

## 5. Data model (Postgres, drizzle)

```
contracts
  id           text PRIMARY KEY
  network      text NOT NULL            'testnet' | 'mainnet'
  name         text
  wasm_hash    text
  spec_ledger  bigint
  model        jsonb                    ContractModel
  llms_txt     text
  openapi      jsonb
  mcp_scope    text NOT NULL DEFAULT 'ro'   'ro' | 'rw'
  status       text NOT NULL            'queued' | 'running' | 'ready' | 'failed'
  steps        jsonb NOT NULL           [{ name, status, detail, error? }]
  error        text
  created_at, updated_at timestamptz

fn_hints
  contract_id  text REFERENCES contracts(id) ON DELETE CASCADE
  fn           text
  kind         text NOT NULL            'read' | 'write'
  observed_at  timestamptz
  PRIMARY KEY (contract_id, fn)
```

## 6. REST contract

Base URL `PUBLIC_BASE_URL` (prod: `https://api.sonata.brages.uk`). JSON everywhere except `llms.txt`.

| Method / path | Purpose | Success |
|---|---|---|
| `POST /contracts` `{id, network, name?}` | Register / re-check | `202 {id, network, status, steps}` |
| `GET /contracts` | Registered list | `200 [{id, name, network, status, fns, updated_at}]` |
| `GET /c/:id` | Model + settings | `200 {…ContractModel, mcp_scope, status, urls: {mcp, llms, openapi}}` |
| `GET /c/:id/status` | Pipeline steps | `200 {status, steps, error?}` |
| `PATCH /c/:id` `{name?, mcp_scope?}` | Settings | `200 {…same as GET}` |
| `POST /c/:id/call/:fn` `{args, source?, network?}` | Simulate any function | `200 {result, simulated: true, latency_ms, ledger, auth: string[]}` |
| `POST /c/:id/tx/:fn` `{args, source, fee?, timeout_s?, network?}` | Unsigned XDR | `200 {xdr, fee, auth: string[], ledger, expires_at}` |
| `POST /c/:id/submit` `{xdr}` | Relay signed tx, wait ≤ 30 s | `200 {hash, status: 'success'\|'failed'\|'pending', ledger?, fee_charged?, result?}` |
| `GET /tx/:hash?network=` | Poll a submit | same shape |
| `GET /c/:id/llms.txt` | AI docs | `text/markdown` |
| `GET /c/:id/openapi.json` | Per-contract OpenAPI 3.1 | JSON |
| `GET /c/:id/events` | History | `501 {error: 'not_indexed'}` |
| `GET /healthz` | Liveness | `200 {db: ok, networks: {testnet: ok, mainnet: 'disabled'}}` |

- `/call` works for every function, including ones that need auth: simulation runs in recording mode and `auth` lists the addresses that would have to sign. `source` defaults to `SIM_SOURCE_ACCOUNT`.
- `/tx` requires `source` (its sequence number goes into the envelope); `timeout_s` default 300; `fee` default = simulated resource fee + base fee.
- `/submit` polls `getTransaction` up to 30 s and returns `pending` with the hash if still unresolved; `GET /tx/:hash` continues polling.
- `network` in bodies is optional; a mismatch with the registered network is `400 network_mismatch`.

### 6.1 Argument encoding

Documented once in the generated OpenAPI. Uses stellar-sdk's `contract.Spec` conventions so `funcArgsToScVals` / `funcResToNative` do the work.

| Spec type | JSON in | JSON out |
|---|---|---|
| `i64 u64 i128 u128 i256 u256` | decimal string (JSON number accepted if ≤ 2^53) | decimal string |
| `i32 u32` | number | number |
| `bool` | boolean | boolean |
| `Address` | `G…` / `C…` string | string |
| `Bytes`, `BytesN<N>` | hex `0x…` | hex `0x…` |
| `Symbol`, `String` | string | string |
| `Vec<T>` | array | array |
| `Map<K,V>` | object (string keys) | object |
| `Option<T>` | value or `null` | value or `null` |
| struct | object | object |
| enum (unit variant) | `"Name"` | `"Name"` |
| union (tuple variant) | `{ "tag": "Name", "values": [...] }` | same |
| tuple | array | array |

### 6.2 Error envelope

```
{ "error": "<machine_code>", "message": "<human>", "code": <n>?, "details": {...}? }
```

| HTTP | `error` | When |
|---|---|---|
| 400 | `invalid_args` | zod or spec encoding failed; `details.path` names the argument |
| 400 | `invalid_contract_id`, `invalid_xdr`, `source_not_found`, `network_not_configured`, `network_mismatch` | |
| 404 | `contract_not_found`, `function_not_found`, `tx_not_found` | |
| 409 | `contract_not_ready` | pipeline running or failed; `details.steps` |
| 422 | `<ErrorName>` + `code` | simulation hit `Error(Contract, #n)` and the spec names it, e.g. `{"error":"SlippageExceeded","code":2}` |
| 422 | `contract_error` + `code` | contract error with no name in the spec |
| 422 | `host_error` | non-contract VM/host failure; raw diagnostic events in `details` |
| 502 | `rpc_unavailable` | RPC timeout/5xx after one retry |
| 501 | `not_indexed` | events in M1 |
| 500 | `internal` | anything else; logged with request id |

### 6.3 Cross-cutting

`@fastify/cors` (configured origins; `*` for GET), `@fastify/rate-limit` 120 req/min/IP, pino JSON logs with request id / contract id / function / latency, 10 s RPC timeout with one retry on network errors.

## 7. MCP server

Endpoint `/c/:id/mcp`, `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` (stateless). One `McpServer` per contract, built lazily from `ContractModel` and cached in-process; the entry is dropped on `PATCH` or re-registration. Server name `sonata-<name-or-short-id>`.

| Tool | Listed when | Input | Returns |
|---|---|---|---|
| `call_{fn}` (one per function) | always | fn JSON Schema + `source?` | same as `POST /call` |
| `build_{fn}` (one per function) | `mcp_scope = 'rw'` | fn JSON Schema + `source` | same as `POST /tx` |
| `submit_transaction` | `mcp_scope = 'rw'` | `{xdr}` | same as `POST /submit` |
| `search_functions` | always | `{query}` | `[{name, signature, doc, kind}]` |
| `get_docs` | always | — | llms.txt |

- Names: prefix + function name, clipped to 64 chars (MCP limit).
- Descriptions: SEP-48 `doc` + rendered signature.
- Results: `content: [{type: 'text', text: JSON}]` **and** `structuredContent`, with `outputSchema` from the return type.
- Contract/host errors → `isError: true` with the REST error envelope as text.
- One resource `sonata://c/{id}/llms.txt`.
- `get_events` is omitted in M1 (arrives with the indexer).
- No auth in M1; a later milestone adds `Authorization: Bearer <api key>`.

## 8. Docs generation

Two pure functions in `docs/`, run at pipeline step 3 and stored on the contract row.

- `llmsTxt(model, config)` — `# <name>`, one-line summary (`Soroban contract · N functions · SEP-48 · <network>`), `## Endpoints` (base URL, `/call` and `/tx` patterns, one curl example, MCP URL), `## Functions` (one `sig → ret` line per function followed by its doc), `## Types`, `## Errors` (`code Name · doc`), `## Events`. Deterministic.
- `openapi(model, config)` — OpenAPI 3.1: `servers: [PUBLIC_BASE_URL]`, one path per function for `/c/{id}/call/{fn}` and `/c/{id}/tx/{fn}`, request schema `{args: <fn schema>, source?}`, response schemas from 6, `components.schemas` from `model.types`, shared error envelope, plus the fixed endpoints (`/submit`, `/status`, `/llms.txt`).

## 9. Configuration

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | |
| `DATABASE_URL` | — (required) | Postgres |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | baked into llms.txt, OpenAPI and MCP URLs |
| `RPC_URL_TESTNET` | `https://soroban-testnet.stellar.org` | |
| `RPC_URL_MAINNET` | unset | unset = mainnet disabled (`400 network_not_configured`) |
| `SIM_SOURCE_ACCOUNT` | a fixed valid `G…` | default `source` for `/call` |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated |
| `LOG_LEVEL` | `info` | |

## 10. Testing

| Layer | Network | Proves |
|---|---|---|
| `spec/` unit | none | fixture WASM → expected `ContractModel`; JSON⇄ScVal round-trip per type family; hint heuristics; JSON Schema shape |
| `docs/` snapshot | none | llms.txt and openapi.json byte-stable for the fixture |
| `http/` routes | none | Fastify `inject()` with a fake `chain`; every endpoint and every error code |
| `mcp/` | none | `tools/list` by scope; `call_*` round-trip through the SDK's in-memory transport |
| `registry/` | Postgres | step persistence, idempotent re-register, wasm-hash change → regen |
| e2e (`test:e2e`) | testnet | register fixture → ready → `/call` → `/tx` (auth lists signer) → sign with `E2E_SECRET_KEY` → `/submit` → `success`; same flow via MCP client |

**Fixture:** `server/test/fixtures/kitchen-sink/` — a Rust contract with one function per type family, one function requiring `require_auth`, one returning a custom `Error`, one event. Source and built WASM are committed; deployed once to testnet, ID in `.env.test`.

## 11. Ops

- `server/Dockerfile` multi-stage `node:22-slim`; migrations run on boot.
- `server/docker-compose.yml`: api + Postgres 16; `npm run dev` = `tsx watch`.
- Fly.io: `fly.toml`, Fly Postgres, cert for `api.sonata.brages.uk`.
- `/healthz` checks DB and `getHealth` per configured network.
- GitHub Actions: typecheck + unit + route + registry tests on push (Postgres service container); e2e on `workflow_dispatch` and nightly.

## 12. Follow-on milestones (not in this spec)

M2 site wiring (`NEXT_PUBLIC_API_URL`; Register, Functions, MCP, Docs, Overview tabs onto the real endpoints) · M3 accounts + API keys + scopes · M4 history indexer (`/events`, `get_events`, stats, CSV/JSON) · M5 flows · M6 explorer.
