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
| `POST /contracts` `{id, network, name?}` | Register / re-check | `202 {id, network, status, steps}` |
| `GET /contracts` | Registered list | `200 [{id, name, network, status, fns, updated_at}]` |
| `GET /c/:id` | Model + settings | `200 {…ContractModel, mcp_scope, status, urls: {mcp, llms, openapi}}` |
| `GET /c/:id/status` | Pipeline steps | `200 {status, steps, error?}` |
| `PATCH /c/:id` `{name?, mcp_scope?}` | Settings | `200 {…same as GET}` |
| `POST /c/:id/call/:fn` `{args, source?, network?}` | Simulate any function | `200 {result, simulated: true, latency_ms, ledger, auth: string[]}` |
| `POST /c/:id/tx/:fn` `{args, source, fee?, timeout_s?, network?}` | Unsigned XDR | `200 {xdr, fee, auth: string[], ledger, expires_at}` |
| `POST /c/:id/submit` `{xdr}` | Relay signed tx, wait ≤ 30 s | `200 {hash, status: 'success'\|'failed'\|'pending', ledger?, fee_charged?, return_value?, result_xdr?}` |
| `GET /tx/:hash?network=` | Poll a submit | same shape |
| `GET /c/:id/llms.txt` | AI docs | `text/markdown` |
| `GET /c/:id/openapi.json` | Per-contract OpenAPI 3.1 | JSON |
| `GET /c/:id/events` | History | `501 {error: 'not_indexed'}` |
| `GET /healthz` | Liveness | `200 {db: 'ok', networks: {testnet: 'ok'}}` |

`return_value` is the invocation's returned ScVal (base64), present on success only; `result_xdr` is the whole `TransactionResult` (base64), present on success and failure. A submit is never retried, and `DUPLICATE` / `TRY_AGAIN_LATER` from the RPC are reported as `pending` (then polled), not as an error — only `ERROR` is `422 submit_rejected`.

`healthz` is a liveness probe for this process: it answers `503` only when the database does not answer a `select 1`. `networks` lists just the configured networks (`ok`/`error` per network, an unconfigured one omitted entirely) — a degraded RPC is reported there but still answers `200`, so the platform does not recycle an otherwise healthy instance.

## MCP

Each registered contract exposes its own MCP server over Streamable HTTP:

```bash
claude mcp add --transport http sonata-<name> https://api.sonata.brages.uk/c/<id>/mcp
```

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
    docs/
      llms.ts                 llmsTxt(model, cfg)
      openapi.ts              openapi(model, cfg)
    http/
      app.ts                  buildApp(deps) → Fastify instance
      routes/contracts.ts     POST/GET /contracts, GET /c/:id, /status, PATCH
      routes/invoke.ts        /call, /tx, /submit, /tx/:hash
      routes/docs.ts          /llms.txt, /openapi.json, /events (501)
      routes/health.ts        /healthz
    mcp/
      tools.ts                buildMcpServer(model, scope, deps) → McpServer
      route.ts                Fastify handler using NodeStreamableHTTPServerTransport
    main.ts                   boot
  drizzle/                    generated SQL migrations
  test/
    fixtures/kitchen-sink/    Cargo.toml, src/lib.rs, kitchen_sink.wasm
    helpers/fakeChain.ts      scripted Chain for route + mcp tests
    spec/*.test.ts  chain/*.test.ts  registry/*.test.ts  docs/*.test.ts  http/*.test.ts  mcp/*.test.ts
    e2e/flow.test.ts          testnet
```
