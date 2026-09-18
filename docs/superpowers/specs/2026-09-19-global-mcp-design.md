# M4 — Global MCP (design)

**Status:** approved in conversation on 2026-09-19 ("1 MCP, 1000 contracts"; `build/submit` present but gated by each contract's `mcp_scope`). Builds on M1 (`2026-09-17-sonata-server-core-engine-design.md`) and M3 (`2026-09-18-m3-real-data-ownership-design.md`). Branch `m4-global-mcp`, stacked on `m3-real-data` (PR #2).

## 1. Goal

Today an agent needs one MCP endpoint per contract (`/c/:id/mcp`). After M4 an agent adds **one** endpoint — `POST /mcp` — and can discover and use every contract registered with Sonata, on any network, with a fixed set of generic tools. The per-contract endpoints stay (scoped tool sets are still useful), but the global endpoint becomes the primary thing the site and docs advertise.

Non-goals: authentication on MCP, per-agent scopes or keys, MCP sessions/state, history tools (still M-history), changing the per-contract tool shapes.

## 2. Why generic tools

Per-function tools (`call_<fn>`) do not scale to the whole registry: 1,000 contracts × ~15 functions is tens of thousands of tools, which no MCP client lists usefully. The global server therefore exposes a small fixed toolset that takes the contract id as an argument; `get_contract` returns each function's JSON schema so an agent can build valid `args`, and `call`/`build` validate `args` at runtime with the same codec the REST API uses (identical errors).

## 3. Endpoint

- `GET|POST|DELETE /mcp` — stateless Streamable HTTP, a fresh `McpServer` per request (same transport pattern as `/c/:id/mcp`), rate limit 600/min per IP (same as the per-contract endpoint). Server name `sonata`, version from `package.json`.
- Unknown / not-ready contracts inside a tool call return an `isError` result carrying the usual envelope (`contract_not_found` 404 / `contract_not_ready` 409 shapes) — never an HTTP error, since the endpoint itself always exists.

## 4. Tools (all on the global server)

| Tool | Input | Output | Notes |
|---|---|---|---|
| `list_contracts` | `{ network?: 'testnet'|'mainnet', q?: string, include_pending?: boolean }` | `{ contracts: [{ id, name, network, status, fns, sac, owner, updated_at }] }` | Ready rows only unless `include_pending`; `q` is a case-insensitive substring on name or id; sorted by `updated_at` desc; capped at 200 |
| `get_contract` | `{ id }` | `{ id, name, network, sac, mcp_scope, functions: [{ name, signature, doc, kind, input_schema }], types, errors, events, urls }` | The public row minus pipeline steps, with `input_schema` = the function's JSON schema (the same one `call`/`build` validate against) |
| `search_functions` | `{ id, query }` | `{ functions: [{ name, signature, doc, kind }] }` | Same semantics as the per-contract tool |
| `get_docs` | `{ id }` | `{ text }` | llms.txt |
| `call` | `{ id, fn, args?, source? }` | `{ result, simulated: true, latency_ms, ledger, auth }` | Simulation; `source` optional (defaults to the configured sim account); learns read/write hints exactly like REST |
| `build` | `{ id, fn, args?, source, fee?, timeout_s? }` | `{ xdr, fee, auth, ledger, expires_at }` | **Only if the contract's `mcp_scope` is `rw`**; otherwise `isError` `{ error: 'write_tools_disabled', message: 'the owner of <id> has not enabled write tools; ask them to switch the MCP scope to read + write' }` |
| `submit` | `{ id, xdr }` | `{ hash, status, ledger?, fee_charged?, return_value?, result_xdr? }` | Same `rw` gate; waits ≤ 30 s |
| `get_tx` | `{ hash, network }` | same as `submit` | Poll a pending submit |

`args` for `call`/`build` is a free-form object in the tool schema (`{ type: 'object' }`) and is validated by the codec at call time; a bad argument comes back as the `invalid_args` envelope with `details.path`, identical to REST. `source` validation is identical to the per-contract tools (`invalid_args` before any RPC call).

Tool descriptions tell the agent the workflow: `list_contracts` → `get_contract` (schemas) → `call` / `build` → hand the XDR to the user's wallet → `submit`.

## 5. Resources

- `sonata://contracts` — JSON list (same shape as `list_contracts` with defaults), `application/json`.
- `sonata://c/{id}/llms.txt` — resource template; `list` enumerates ready contracts, `read` returns the stored llms.txt (`text/markdown`).

## 6. Implementation shape (server)

- `src/mcp/handlers.ts` (new): the shared per-tool logic extracted from `src/mcp/tools.ts` — `simulate(deps, ready, fn, args, source)`, `buildTx(deps, ready, fn, args, source, opts)`, `submitTx(deps, ready, xdr)`, `getTx(deps, network, hash)`, `searchFunctions(model, query)`, `docsOf(deps, id)`, `ok()`, `fail()`, `checkSource()`, the output schemas. `tools.ts` (per-contract) and the new `src/mcp/global.ts` both call these, so behaviour cannot drift.
- `src/mcp/global.ts` (new): `buildGlobalMcpServer(deps): McpServer` registering the eight tools and two resources; every contract-scoped tool resolves the contract with `deps.registry.ready(id)` (which already throws the right `ApiError`s) and reads `row.mcpScope` for the write gate.
- `src/mcp/route.ts`: register `/mcp` next to `/c/:id/mcp` with the same transport/rate-limit config.
- `src/docs/llms.ts`: the per-contract llms.txt "Endpoints"/MCP line also names the global endpoint. `src/docs/openapi.ts`: unchanged.
- README: new endpoint row + a short "Global MCP" section with the tool table.

## 7. Site

- `lib/api.js`: `mcpGlobalUrl = API_URL + '/mcp'`; `contracts.urls(id)` unchanged.
- **Home**: the "AI agent setup" block shows the global config `{"mcpServers":{"sonata":{"url":"<API>/mcp","type":"http"}}}` and `claude mcp add --transport http sonata <API>/mcp` — no per-contract example needed any more (the curl block keeps using the latest ready contract).
- **Explorer**: a "Connect an agent" strip above the list with the global URL + Copy.
- **Workspace › MCP tab**: two sections — "All contracts (recommended)" with the global config/one-liner, then "This contract only" with today's scoped config; the scope control and tool table stay as they are (the table is the scoped tool set; add one sentence: "The global endpoint exposes this contract through `call`/`build`/`submit` under the same scope").
- **Public contract page**: the "Connect an agent" box shows the global config (plus a small "scoped endpoint" line).
- **Docs › MCP page**: rewritten around the global endpoint (tool table from §4, the workflow paragraph, the scope rule), with the per-contract endpoint as a second section.

## 8. Errors

Tool results use the existing envelope inside `isError` results. New code: `write_tools_disabled` (403). Everything else reuses `contract_not_found`, `contract_not_ready`, `invalid_args`, `function_not_found`, contract errors by spec name, `rpc_unavailable`.

## 9. Testing

- `server/test/mcp/global.test.ts` (in-process `Client` over the app, like `route.test.ts`): tools/list shows exactly the eight tools; `list_contracts` filters by network/q and hides pending rows by default; `get_contract` returns `input_schema` per function and `mcp_scope`; `search_functions`/`get_docs`; `call` simulates via `FakeChain` and learns a hint; `build`/`submit` are `write_tools_disabled` on an `ro` contract and work after `PATCH mcp_scope=rw` (with a signed-in owner); `get_tx`; unknown id → `isError` with `contract_not_found`; resources list + read.
- `server/test/mcp/tools.test.ts` keeps passing unchanged (the extraction must not alter per-contract behaviour).
- Server e2e (`flow.test.ts`): one global-MCP case against testnet — `list_contracts` contains the fixture, `call` `add(2,3)` → `"5"`, `build bump` after enabling `rw`.
- Site unit: Mcp tab renders both sections with the right URLs; Home block shows the global config; docs page has no per-contract-only wording as the primary path.
- Playwright: the MCP tab assertion also checks the global URL text is present.

## 10. Deployment

No env, no migration. Rate limits unchanged. The endpoint is public like the rest of the read surface; writes remain gated per contract by its owner.
