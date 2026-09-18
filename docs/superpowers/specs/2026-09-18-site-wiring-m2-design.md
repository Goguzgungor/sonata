# Sonata site — M2 wiring to the real API (design)

**Date:** 2026-09-18
**Status:** approved in brainstorming
**Depends on:** M1 server (`server/`, merged in PR #1) — endpoints in `docs/superpowers/specs/2026-09-17-sonata-server-core-engine-design.md` §6/§7/§14.

## 1. Goal and scope

Make the Next.js site use the real Sonata API for the contract lifecycle: **Register → Contracts → workspace (Overview, Functions, MCP, Docs) → public contract page.** Everything else keeps its demo data behind the preview banner.

| Screen | M2 | Source |
|---|---|---|
| `/register` | live | `POST /contracts`, poll `GET /c/{id}/status` |
| `/contracts` | live | `GET /contracts` |
| `/c/{id}/overview` | live (model-derived only) | `GET /c/{id}` |
| `/c/{id}/functions` | live: simulate + unsigned XDR | `POST /c/{id}/call/{fn}`, `POST /c/{id}/tx/{fn}` |
| `/c/{id}/mcp` | live: scope toggle, tool list, config | `GET /c/{id}`, `PATCH /c/{id}` |
| `/c/{id}/docs` | live | `GET /c/{id}/llms.txt`, `GET /c/{id}/openapi.json` |
| `/c/{id}/history` | demo (preview banner) | — (M4) |
| `/explorer/{id}` | live for registered ids; demo catalogue entries otherwise | `GET /c/{id}` |
| `/`, `/explorer`, `/flows`, `/keys`, `/docs` | unchanged demo | — |

**Not in M2:** Freighter signing / `POST /submit` (M2b), history (M4), flows (M5), explorer catalogue (M6), auth/keys (M3), mainnet-specific UX beyond surfacing `network_not_configured`.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Data fetching | Client-side: `lib/api.js` fetch wrapper + `lib/useApi.js` hook (`useApi`, `usePoll`); no data library | The UI kit renders only after mount, so SSR data buys nothing on private screens; ~8 fetches don't justify a cache library |
| SSR exception | `app/explorer/[id]/page.jsx` `generateMetadata` fetches `GET /c/{id}` server-side for title/description | Shared public links should unfurl with the contract name |
| API base URL | `NEXT_PUBLIC_API_URL`, default `http://localhost:8080`; production `https://api.sonata.brages.uk` set in Vercel | API CORS already allows both origins |
| Workspace route | `/c/[id]/[tab]` (dynamic) replaces `/c/[tab]`; `/c/[id]` → redirect to `overview` | Multi-contract |
| Preview banner | Rendered by demo screens via `<PreviewBar />`, not globally; live screens show the contract's real network chip | Banner must not claim "sample data" on live screens |
| Nav wallet | Removed (no accounts until M3) | It was fake |
| Functions tab | Real simulate and real unsigned XDR with copy/download; no Freighter button; reads default `source` to the API's simulation account, writes require a user-typed `G…` `source` | Signing is M2b |
| Overview | Model-derived facts only (counts, network, wasm hash, status, surfaces, links); fake stats/chart/events removed | History-dependent tiles return in M4 |
| Dependencies | Runtime: none new. Dev: `vitest`, `@testing-library/react`, `jsdom`, `@playwright/test` | Keep the site lean |

## 3. Data layer

`lib/api.js` (framework-free):
```js
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
export class ApiError extends Error { constructor(status, error, message, extra = {}) — fields: status, error, code?, details? }
export async function api(path, { method = 'GET', body, signal, text = false } = {})
  // JSON in/out; non-2xx → ApiError from the server envelope { error, message, code?, details? }
  // fetch rejection → ApiError(0, 'network', `Can't reach the API at ${API_URL}`)
  // text: true → returns response text (llms.txt)
export const contracts = {
  list: () => GET /contracts,
  register: (id, network, name?) => POST /contracts,
  get: (id) => GET /c/{id},
  status: (id) => GET /c/{id}/status,
  patch: (id, patch) => PATCH /c/{id},
  call: (id, fn, args, source?) => POST /c/{id}/call/{fn},
  tx: (id, fn, args, source, opts?) => POST /c/{id}/tx/{fn},
  llms: (id) => GET /c/{id}/llms.txt as text,
  urls: (id) => ({ base, mcp, llms, openapi })   // pure
};
export const shortId = (id) => id.slice(0, 4) + '…' + id.slice(-4);
export const isContractId = (s) => /^C[A-Z2-7]{55}$/.test(s);
export const isAccountId  = (s) => /^G[A-Z2-7]{55}$/.test(s);
```

`lib/useApi.js`:
- `useApi(fetcher, deps)` → `{ data, error, loading, refetch }`; runs on mount and when `deps` change; aborts in-flight requests on unmount/dep change via `AbortController`.
- `usePoll(fetcher, { every = 1500, until, enabled })` → same shape, re-runs every `every` ms until `until(data)` is true or `enabled` is false; cleans up its timer.

`components/Async.jsx`: `<Async loading error onRetry skeleton>{children}</Async>` — loading → `skeleton` (muted placeholder blocks); error → inline panel with `message`, machine `error` in mono, Retry; else children. Network errors name the API URL.

`components/PreviewBar.jsx`: the existing banner markup, used by demo screens (Explorer catalogue, Flows, Keys, home, History tab).

## 4. Screens

**Register** — fields: Contract address (validated with `isContractId`; Generate disabled until valid), Name (optional), Network segmented. Generate → `contracts.register` → `usePoll(status, until ready|failed)`. Pipeline rows come from `steps[]` (`fetch`, `parse`, `generate`, `index`) with chips: queued → neutral "Queued", running → warning "Running", done → good "Done", skipped → neutral "Skipped", failed → bad "Failed"; `detail` in mono; a failed step shows its `error`. `invalid_contract_id` / `network_not_configured` / network failure render under the field. `ready` → button "Open contract workspace" → `/c/{id}/overview`. `?id=` prefill supported.

**Contracts** — `useApi(contracts.list)`. Card: name or `shortId`, full id, network chip (testnet neutral / mainnet inverse), status chip (ready → good "Indexed"; queued/running → warning "Indexing"; failed → bad "Failed"), `fns` functions, relative `updated_at`. Link → `/c/{id}/overview` (failed → `/register?id={id}`). Empty state with "Add a contract". Header count = list length.

**Workspace shell** — `useApi(contracts.get(id), [id])`. Header: name/shortId, id + copy, network chip, status chip, "Rename" (prompt-less inline field → `PATCH { name }` → refetch), "Copy MCP URL" (`urls.mcp`). Tabs: Overview, Functions (count = functions.length), MCP (count = functions.length + 2, or ×2 + 3 when `mcp_scope === 'rw'`), Docs, History. 404 → "Not registered" panel with Register link; 409 → pipeline steps from `details.steps`, polled until ready.

**Overview** — Stat row: Functions / Types / Errors / Events. KeyValueList: Network, Contract ID, WASM hash (first 12), Registered (`created_at`), Status, MCP scope. Surfaces: REST API → functions tab (`N endpoints · /call · /tx`), MCP server → mcp tab (`N tools · read-only by default` or `read + write`), Docs → docs tab (`llms.txt · OpenAPI`), History → history tab (chip "preview"). Link to `urls.openapi`.

**Functions** — Table rows from `functions`: signature `name(in: type, …) → output`, kind chip (read neutral "Read", write inverse "Write", unknown neutral "—"). Row click selects; detail panel: one input per `inputs[]` (label = name, hint = type, placeholder from the schema: decimal strings `"0"`, `G…` for addresses, `0x…` for bytes, JSON for object/array types), mode Segmented (Simulate / Build transaction), `source` field shown for Build (required, `isAccountId`) and optional for Simulate. Simulate → result box: pretty JSON `result`, `latency_ms`, `auth` ("Must sign: …" when non-empty). Build → XDR box (Copy, Download `.xdr`), fee, expires_at, auth. Errors: 422 shows `error` + `message` (+ `code`); 400 `invalid_args` marks the field named by `details.path` invalid and shows the message; other errors via the standard inline panel. Arg coercion (`lib/args.js`): `boolean` → checkbox; `integer` schema → number input → JS number; `string` schemas → string as typed; `object`/`array`/`anyOf`/`oneOf` schemas → JSON textarea parsed with a clear error on invalid JSON; empty optional → omitted.

**MCP** — Endpoint `urls.mcp` + copy. Scope Segmented (ro/rw) → `PATCH { mcp_scope }` optimistic, revert + inline error on failure. Tool table from the model: `call_{fn}` (read tools, always on), `build_{fn}` (write, on iff rw), `submit_transaction` (write, on iff rw), `search_functions`, `get_docs` (on). Config block: `{ "mcpServers": { "sonata-<slug>": { "url": urls.mcp, "type": "http" } } }` + `claude mcp add --transport http sonata-<slug> <url>`; Claude/Cursor/Codex buttons copy the JSON.

**Docs** — `useApi(contracts.llms(id))` → text in the code panel. KeyValueList: Format `Markdown · llms.txt`, Generated (`updated_at` relative), Source `SEP-48 spec`, URL `urls.llms`. Buttons: Copy link, Download `.md` (`<name>.md`), OpenAPI JSON (external link). No Regenerate.

**Public page** — `app/explorer/[id]/page.jsx`: `generateStaticParams` removed; `generateMetadata` tries `fetch(GET /c/{id})` server-side (3 s timeout) → title `name · Explorer`, else falls back to the demo catalogue entry, else generic. Page renders `<ContractPublic id />`, which uses `useApi(contracts.get(id))`: on success renders the live layout (name, id, network, Functions table from the model, MCP config, llms.txt link, "Open workspace"); on 404 falls back to the demo entry if `CONTRACT_BY_ID[id]` exists (with `<PreviewBar />`), else the "Not registered" panel with a Register link.

**TopNav** — remove the fake wallet and the global preview bar; keep the network chip only on the home page (`Testnet`).

## 5. Error and loading conventions
- Every live screen: `<Async>` around its data. Skeletons mirror the layout; no spinners.
- Mutations disable their button while in flight; errors render inline next to the control.
- `ApiError` messages come from the server; the machine code is shown in mono for support.
- No client cache; tab navigation refetches `GET /c/{id}`.

## 6. Tests
- **vitest** (`test/site/**`, jsdom for hooks): `api.test.js` (envelope → `ApiError`, network → status 0, URL builders, request bodies, `text` mode); `useApi.test.js` + `usePoll.test.js` (resolve, error, abort on unmount, poll stops on `until`); `args.test.js` (form → args coercion, placeholders, JSON errors).
- **Playwright** (`e2e/site.spec.ts`, manual/nightly; needs local API + Postgres + the testnet fixture): register `CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP` → ready → workspace shows functions → Functions: simulate `add` (a=5, b=7) → `"12"`; Build `ping` with a `G…` source → XDR box → MCP: switch to rw → `build_` rows on → Docs shows `# ` → `/explorer/{id}` renders name + MCP URL.
- CI: `site` job (vitest + `next build`) on push; Playwright on `workflow_dispatch`/nightly.

## 7. Files
```
lib/api.js  lib/useApi.js  lib/args.js
components/Async.jsx  components/PreviewBar.jsx
components/screens/{Register,Contracts,ContractPublic}.jsx        (rewritten)
components/workspace/{Workspace,Overview,Functions,Mcp,Docs}.jsx    (rewritten)
components/TopNav.jsx  components/data.js                           (pruned)
app/c/[id]/[tab]/page.jsx  app/c/[id]/page.jsx                      (new; app/c/[tab] deleted)
app/explorer/[id]/page.jsx                                          (modified)
.env.example  README.md  package.json (scripts + dev deps)  vitest.config.js  playwright.config.js
test/site/*.test.js  e2e/site.spec.ts  .github/workflows/site.yml
```
