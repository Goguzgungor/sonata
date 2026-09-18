# M4 — Global MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One MCP endpoint (`POST /mcp`) that lets an agent discover and use every registered contract through eight generic tools and two resources, with `build`/`submit` gated by each contract's `mcp_scope`; the site and docs advertise it as the primary way to connect an agent.

**Architecture:** The per-tool logic in `server/src/mcp/tools.ts` is extracted into `server/src/mcp/handlers.ts` and reused by a new `server/src/mcp/global.ts` (`buildGlobalMcpServer(deps)`), registered by `route.ts` next to the per-contract route with the same stateless Streamable HTTP transport. Contract-scoped tools resolve the contract with `registry.ready(id)` (existing 404/409 `ApiError`s → `isError` results). Site: a global config block on Home, the Explorer, the public page and the MCP tab (which keeps the scoped section); docs MCP page rewritten.

**Tech Stack:** Server: TypeScript ESM, Fastify 5, `@modelcontextprotocol/server` 2 (`McpServer`, `ResourceTemplate`, `fromJsonSchema`), `@modelcontextprotocol/client` 2 in tests, vitest. Site: Next.js 15 JS/JSX, vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-global-mcp-design.md`

## Global Constraints

- Branch `m4-global-mcp` (stacked on `m3-real-data`, PR #2). Server code TypeScript ESM (`.js` import suffixes); site JS/JSX only; tests: `server/test/**/*.test.ts` (vitest) and `test/site/**` (vitest + jsdom).
- Endpoint: `GET|POST|DELETE /mcp`, stateless (`sessionIdGenerator: undefined`), rate limit `{ max: 600, timeWindow: '1 minute' }` — identical to `/c/:id/mcp`. Server name `sonata`, version `'0.1.0'`.
- Exactly these tools on the global server: `list_contracts`, `get_contract`, `search_functions`, `get_docs`, `call`, `build`, `submit`, `get_tx`. Resources: `sonata://contracts` (JSON) and template `sonata://c/{id}/llms.txt` (markdown).
- Write gate: `build` and `submit` return `isError` with `{ error: 'write_tools_disabled', message: 'the owner of <id> has not enabled write tools; ask them to switch the MCP scope to read + write' }` (status 403) unless `row.mcpScope === 'rw'`.
- Tool results: `ok(data)` = `{ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }`; `fail(err)` = envelope as text + `isError: true` — the same helpers the per-contract tools use. Contract errors are renamed through `namedContractError` exactly as today.
- Per-contract tool behaviour and names are unchanged (`test/mcp/tools.test.ts` keeps passing without edits, except that `call_*`/`call` now also learn read/write hints like REST does).
- Site copy (exact): section labels `All contracts (recommended)` and `This contract only`; global config key `sonata`; one-liner `claude mcp add --transport http sonata <API>/mcp`.
- Commit per task, body ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never touch `.env*` files.

---

## File structure

Server (create): `src/mcp/handlers.ts`, `src/mcp/global.ts`, `test/mcp/global.test.ts`. Server (modify): `src/mcp/tools.ts`, `src/mcp/route.ts`, `src/docs/llms.ts` (+ snapshot), `README.md`, `test/e2e/flow.test.ts`.
Site (modify): `lib/api.js`, `components/workspace/Mcp.jsx`, `components/screens/Welcome.jsx`, `components/screens/Explorer.jsx`, `components/screens/ContractPublic.jsx`, `components/docs-data.js`, `e2e/site.spec.ts`. Site (create): `test/site/mcp-tab.test.jsx`.

---

### Task 1: extract shared MCP handlers

**Files:**
- Create: `server/src/mcp/handlers.ts`
- Modify: `server/src/mcp/tools.ts`

**Interfaces:**
- Produces (`handlers.ts`): `type Ready = { row: ContractRow; model: ContractModel; spec: contract.Spec }`; `ok(data)`, `fail(e)`, `checkSource(s, required)`, `sig(f)`, `withSource(schema, required)`, schemas `CALL_OUT`, `BUILD_OUT`, `TX_OUT`, `DOCS_OUT`; `simulate(deps, r, fn, args, source?)`, `buildTx(deps, r, fn, args, source, opts?)`, `submitTx(deps, r, xdr)`, `getTx(deps, network, hash)`, `searchFunctions(model, query)`, `docsOf(deps, id)`, `txJson(t)`.

- [ ] **Step 1: Move the helpers**

Create `server/src/mcp/handlers.ts` with the `ok`, `fail`, `checkSource`, `sig`, `withSource`, `toolName`/`MAX_NAME` and the four `*_OUT` schemas moved verbatim from `tools.ts`, plus:

```ts
import type { contract } from '@stellar/stellar-sdk';
import type { Deps } from '../http/deps.js';
import type { ContractRow } from '../registry/store.js';
import type { ContractModel, Network } from '../types.js';
import type { TxStatus } from '../chain/types.js';
import { decodeResult, encodeArgs, namedContractError } from '../spec/codec.js';
import { notFound } from '../errors.js';

export type Ready = { row: ContractRow; model: ContractModel; spec: contract.Spec };

const requireFn = (model: ContractModel, fn: string) => { if (!model.functions.some((f) => f.name === fn)) throw notFound('function', fn); };

/** Simulate `fn` and, like the REST route, learn a read/write hint when the observed kind differs. */
export async function simulate(deps: Deps, r: Ready, fn: string, args: Record<string, unknown>, source?: unknown) {
  checkSource(source, false); requireFn(r.model, fn);
  try {
    const sim = await deps.chain.simulate(r.model.network, r.model.id, fn, encodeArgs(r.spec, fn, args), (source as string) ?? deps.cfg.simSourceAccount);
    const kind = sim.auth.length === 0 && sim.readWriteCount === 0 ? 'read' : 'write';
    if (r.model.functions.find((f) => f.name === fn)!.kind !== kind) { try { await deps.registry.learnHint(r.model.id, fn, kind); } catch (e) { deps.log.warn({ err: e }, 'hint'); } }
    return { result: decodeResult(r.spec, fn, sim.retval), simulated: true, latency_ms: sim.latencyMs, ledger: sim.ledger, auth: sim.auth };
  } catch (e) { namedContractError(e, r.model, r.spec); throw e; }
}
export async function buildTx(deps: Deps, r: Ready, fn: string, args: Record<string, unknown>, source: unknown, opts: { fee?: string; timeoutS?: number } = {}) {
  checkSource(source, true); requireFn(r.model, fn);
  try {
    const b = await deps.chain.buildTx(r.model.network, r.model.id, fn, encodeArgs(r.spec, fn, args), source as string, { fee: opts.fee, timeoutS: opts.timeoutS ?? 300 });
    return { xdr: b.xdr, fee: b.fee, auth: b.auth, ledger: b.ledger, expires_at: b.expiresAt };
  } catch (e) { namedContractError(e, r.model, r.spec); throw e; }
}
export const txJson = (t: TxStatus) => ({ hash: t.hash, status: t.status, ...(t.ledger !== undefined && { ledger: t.ledger }), ...(t.feeCharged && { fee_charged: t.feeCharged }), ...(t.returnValue && { return_value: t.returnValue }), ...(t.resultXdr && { result_xdr: t.resultXdr }) });
export async function submitTx(deps: Deps, r: Ready, xdr: string) {
  try { return txJson(await deps.chain.submit(r.model.network, xdr, 30_000)); } catch (e) { namedContractError(e, r.model, r.spec); throw e; }
}
export const getTx = async (deps: Deps, network: Network, hash: string) => txJson(await deps.chain.getTx(network, hash));
export const searchFunctions = (model: ContractModel, query: string) => {
  const q = query.toLowerCase();
  return model.functions.filter((f) => f.name.toLowerCase().includes(q) || f.doc.toLowerCase().includes(q)).map((f) => ({ name: f.name, signature: sig(f), doc: f.doc, kind: f.kind })).sort((a, b) => a.name.localeCompare(b.name));
};
export const docsOf = async (deps: Deps, id: string) => (await deps.registry.ready(id)).row.llmsTxt ?? '';
```

(`namedContractError` throws the renamed error itself when the input is a contract error and returns otherwise — check its signature in `src/spec/codec.ts` and keep the exact semantics `tools.ts` relies on today: `try { namedContractError(e, model, spec); } catch (named) { return fail(named); }`. If it rethrows for every input, the `throw e` lines above are unreachable and may be dropped.)

- [ ] **Step 2: Rewire `tools.ts`**

`buildMcpServer` keeps its signature and tool names; each handler body becomes a one-liner over the shared functions, e.g. `call_*`: `async (args) => { try { const { source, ...rest } = args; return ok(await simulate(deps, r, f.name, rest, source)); } catch (e) { return fail(e); } }` with `const r: Ready = { row, model, spec }` — pass `row` in (add a `row: ContractRow` parameter? No: keep the signature by looking the row up once: `const rowP = deps.registry.ready(model.id)` is wasteful; instead give `Ready` an optional `row` and have `simulate`/`buildTx`/`submitTx` not touch `row`). Concretely: `Ready = { row?: ContractRow; model; spec }` and only the global server sets `row`. `search_functions` → `ok({ functions: searchFunctions(model, query) })`; `get_docs` → `docsOf(deps, model.id)`.

- [ ] **Step 3: Run the existing MCP tests** — `cd server && npx vitest run test/mcp test/http && npm run typecheck` → PASS unchanged (names, descriptions, envelopes).

- [ ] **Step 4: Commit** — `git add server/src/mcp && git commit -m "server: extract shared MCP tool handlers" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 2: the global MCP server and `/mcp` route

**Files:**
- Create: `server/src/mcp/global.ts`, `server/test/mcp/global.test.ts`
- Modify: `server/src/mcp/route.ts`

**Interfaces:**
- Consumes: Task 1 handlers; `deps.store.list({ … })`, `deps.registry.ready(id)`; `publicRow`-like fields.
- Produces: `buildGlobalMcpServer(deps): McpServer`; route `ALL /mcp`.

- [ ] **Step 1: Failing test**

`server/test/mcp/global.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { nativeToScVal } from '@stellar/stellar-sdk';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID } from '../fixtures/index.js';
import { buildGlobalMcpServer } from '../../src/mcp/global.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const text = (r: any) => JSON.parse(r.content[0].text);

async function connect() {
  const t = await testApp(); await t.registerFixture();
  const deps = { cfg: t.cfg, chain: t.chain, registry: t.registry, store: t.store, log: t.app.log as any, auth: t.auth };
  const server = buildGlobalMcpServer(deps);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await server.connect(st); await client.connect(ct);
  return { ...t, client };
}

describe('global MCP server', () => {
  it('exposes exactly the eight generic tools and two resources', async () => {
    const { client } = await connect();
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['build', 'call', 'get_contract', 'get_docs', 'get_tx', 'list_contracts', 'search_functions', 'submit']);
    const res = await client.listResources();
    expect(res.resources.map((r) => r.uri)).toContain('sonata://contracts');
    expect(res.resources.map((r) => r.uri)).toContain(`sonata://c/${FIXTURE_ID}/llms.txt`);
  });
  it('list_contracts filters by network and query and hides pending rows by default', async () => {
    const { client, registry } = await connect();
    await registry.register(OTHER, 'mainnet', 'Pending', G);          // FakeChain resolves it, so wait then mark it queued again
    await registry.whenIdle();
    const all = text(await client.callTool({ name: 'list_contracts', arguments: {} }));
    expect(all.contracts.map((c: any) => c.id).sort()).toEqual([FIXTURE_ID, OTHER].sort());
    expect(all.contracts.find((c: any) => c.id === FIXTURE_ID)).toMatchObject({ name: 'KitchenSink', network: 'testnet', fns: 16, owner: expect.any(String) });
    const tn = text(await client.callTool({ name: 'list_contracts', arguments: { network: 'testnet' } }));
    expect(tn.contracts.map((c: any) => c.id)).toEqual([FIXTURE_ID]);
    const q = text(await client.callTool({ name: 'list_contracts', arguments: { q: 'kitchen' } }));
    expect(q.contracts.map((c: any) => c.id)).toEqual([FIXTURE_ID]);
  });
  it('get_contract returns schemas per function; search_functions and get_docs work; unknown id is an isError envelope', async () => {
    const { client } = await connect();
    const c = text(await client.callTool({ name: 'get_contract', arguments: { id: FIXTURE_ID } }));
    expect(c).toMatchObject({ id: FIXTURE_ID, network: 'testnet', mcp_scope: 'ro' });
    const add = c.functions.find((f: any) => f.name === 'add');
    expect(add.signature).toBe('add(a: i128, b: i128) → i128'); expect(add.input_schema.properties.a).toBeTruthy();
    const s = text(await client.callTool({ name: 'search_functions', arguments: { id: FIXTURE_ID, query: 'echo' } }));
    expect(s.functions.length).toBeGreaterThan(0); expect(s.functions.every((f: any) => f.name.includes('echo'))).toBe(true);
    const d = text(await client.callTool({ name: 'get_docs', arguments: { id: FIXTURE_ID } }));
    expect(d.text).toMatch(/^# KitchenSink/);
    const nope = await client.callTool({ name: 'get_contract', arguments: { id: 'CNOPE' } });
    expect(nope.isError).toBe(true); expect(text(nope)).toMatchObject({ error: 'contract_not_found' });
  });
  it('call simulates with the shared codec and errors like REST', async () => {
    const { client, chain } = await connect();
    chain.impl.simulate = async () => ({ retval: nativeToScVal(3n, { type: 'i128' }), auth: [], ledger: 9, minResourceFee: '1', readWriteCount: 0, latencyMs: 2 });
    const r = await client.callTool({ name: 'call', arguments: { id: FIXTURE_ID, fn: 'add', args: { a: '1', b: '2' } } });
    expect(r.isError).toBeFalsy(); expect(r.structuredContent).toEqual({ result: '3', simulated: true, latency_ms: 2, ledger: 9, auth: [] });
    const bad = await client.callTool({ name: 'call', arguments: { id: FIXTURE_ID, fn: 'add', args: { a: 'x' } } });
    expect(bad.isError).toBe(true); expect(text(bad)).toMatchObject({ error: 'invalid_args' });
    const nofn = await client.callTool({ name: 'call', arguments: { id: FIXTURE_ID, fn: 'nope', args: {} } });
    expect(text(nofn)).toMatchObject({ error: 'function_not_found' });
  });
  it('build and submit are gated by the contract scope; get_tx polls', async () => {
    const { client, store } = await connect();
    const denied = await client.callTool({ name: 'build', arguments: { id: FIXTURE_ID, fn: 'bump', args: {}, source: G } });
    expect(denied.isError).toBe(true); expect(text(denied)).toMatchObject({ error: 'write_tools_disabled' });
    expect((await client.callTool({ name: 'submit', arguments: { id: FIXTURE_ID, xdr: 'AAAA' } })).isError).toBe(true);
    await store.update(FIXTURE_ID, { mcpScope: 'rw' });
    const b = await client.callTool({ name: 'build', arguments: { id: FIXTURE_ID, fn: 'bump', args: {}, source: G } });
    expect(b.isError).toBeFalsy(); expect((b.structuredContent as any).xdr).toBe('AAAA');
    const s = await client.callTool({ name: 'submit', arguments: { id: FIXTURE_ID, xdr: 'AAAA' } });
    expect(s.structuredContent).toMatchObject({ hash: 'h', status: 'success', ledger: 101 });
    const t = await client.callTool({ name: 'get_tx', arguments: { hash: 'abc', network: 'testnet' } });
    expect(t.structuredContent).toMatchObject({ hash: 'abc', status: 'success' });
    const badSrc = await client.callTool({ name: 'build', arguments: { id: FIXTURE_ID, fn: 'bump', args: {}, source: 'nope' } });
    expect(text(badSrc)).toMatchObject({ error: 'invalid_args', details: { path: 'source' } });
  });
  it('resources: the contract list and a contract\'s llms.txt', async () => {
    const { client } = await connect();
    const list = await client.readResource({ uri: 'sonata://contracts' });
    expect(JSON.parse((list.contents[0] as any).text).contracts[0].id).toBe(FIXTURE_ID);
    const doc = await client.readResource({ uri: `sonata://c/${FIXTURE_ID}/llms.txt` });
    expect((doc.contents[0] as any).text).toMatch(/^# KitchenSink/);
  });
});
```

Also append to `server/test/mcp/route.test.ts`:

```ts
describe('ALL /mcp', () => {
  it('serves the global server over Streamable HTTP, stateless', async () => {
    const t = await testApp(); app = t.app; await t.registerFixture();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (t.app.server.address() as any).port;
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    expect((await client.listTools()).tools.map((x) => x.name)).toContain('list_contracts');
    const r = await client.callTool({ name: 'get_contract', arguments: { id: FIXTURE_ID } });
    expect(r.structuredContent).toMatchObject({ id: FIXTURE_ID });
    await client.close();
  });
});
```

- [ ] **Step 2: Run to see them fail** — `cd server && npx vitest run test/mcp` → FAIL (module missing / 404).

- [ ] **Step 3: Implement**

`server/src/mcp/global.ts`:

```ts
import { McpServer, ResourceTemplate, fromJsonSchema } from '@modelcontextprotocol/server';
import type { Deps } from '../http/deps.js';
import type { ContractRow } from '../registry/store.js';
import { ApiError } from '../errors.js';
import { ok, fail, sig, simulate, buildTx, submitTx, getTx, searchFunctions, docsOf, CALL_OUT, BUILD_OUT, TX_OUT, DOCS_OUT, type Ready } from './handlers.js';

const NET = { type: 'string', enum: ['testnet', 'mainnet'] };
const ARGS = { type: 'object', description: 'Function arguments by name — get the schema from get_contract. ≥64-bit ints are decimal strings, bytes 0x-hex, maps objects, enums integers, unions "Name" or {tag, values}.', additionalProperties: true };
const listItem = (r: ContractRow) => ({ id: r.id, name: r.name, network: r.network, status: r.status, fns: r.model?.functions.length ?? 0, sac: r.model?.sac === true, owner: r.owner, updated_at: r.updatedAt.toISOString() });
const writeDisabled = (id: string) => new ApiError(403, 'write_tools_disabled', `the owner of ${id} has not enabled write tools; ask them to switch the MCP scope to read + write`);

/** One server for every registered contract: fixed generic tools, contract id as an argument. Built per request (stateless). */
export function buildGlobalMcpServer(deps: Deps): McpServer {
  const server = new McpServer({ name: 'sonata', version: '0.1.0' });
  const base = deps.cfg.publicBaseUrl;
  const ready = (id: string): Promise<Ready> => deps.registry.ready(id);
  const list = async (o: { network?: string; q?: string; include_pending?: boolean } = {}) => {
    const q = o.q?.toLowerCase();
    return (await deps.store.list()).filter((r) => (o.include_pending || r.status === 'ready') && (!o.network || r.network === o.network) && (!q || (r.name ?? '').toLowerCase().includes(q) || r.id.toLowerCase().includes(q))).slice(0, 200).map(listItem);
  };

  server.registerTool('list_contracts', { description: 'Contracts registered with Sonata (ready ones by default). Start here, then get_contract for a function list and argument schemas.', inputSchema: fromJsonSchema<{ network?: string; q?: string; include_pending?: boolean }>({ type: 'object', properties: { network: NET, q: { type: 'string', description: 'substring of name or id' }, include_pending: { type: 'boolean' } } }) },
    async (a) => { try { return ok({ contracts: await list(a) }); } catch (e) { return fail(e); } });
  server.registerTool('get_contract', { description: 'Functions (with JSON schemas for `args`), types, errors, events, scope and URLs of one contract.', inputSchema: fromJsonSchema<{ id: string }>({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }) },
    async ({ id }) => {
      try {
        const { row, model } = await ready(id);
        return ok({ id: model.id, name: row.name, network: model.network, sac: model.sac === true, mcp_scope: row.mcpScope, owner: row.owner,
          functions: model.functions.map((f) => ({ name: f.name, signature: sig(f), doc: f.doc, kind: f.kind, input_schema: f.jsonSchema })),
          types: model.types, errors: model.errors, events: model.events,
          urls: { rest: `${base}/c/${model.id}`, mcp: `${base}/c/${model.id}/mcp`, llms: `${base}/c/${model.id}/llms.txt`, openapi: `${base}/c/${model.id}/openapi.json` } });
      } catch (e) { return fail(e); }
    });
  server.registerTool('search_functions', { description: 'Find functions of a contract by name or purpose.', inputSchema: fromJsonSchema<{ id: string; query: string }>({ type: 'object', properties: { id: { type: 'string' }, query: { type: 'string' } }, required: ['id', 'query'] }) },
    async ({ id, query }) => { try { const { model } = await ready(id); return ok({ functions: searchFunctions(model, query) }); } catch (e) { return fail(e); } });
  server.registerTool('get_docs', { description: 'llms.txt for a contract.', inputSchema: fromJsonSchema<{ id: string }>({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }), outputSchema: fromJsonSchema(DOCS_OUT) },
    async ({ id }) => { try { const t = await docsOf(deps, id); return { content: [{ type: 'text' as const, text: t }], structuredContent: { text: t } }; } catch (e) { return fail(e); } });
  server.registerTool('call', { description: 'Simulate a contract function (any function, read or write). Nothing is signed or sent. Use get_contract for the args schema.', inputSchema: fromJsonSchema<{ id: string; fn: string; args?: Record<string, unknown>; source?: string }>({ type: 'object', properties: { id: { type: 'string' }, fn: { type: 'string' }, args: ARGS, source: { type: 'string', description: 'G… account used as transaction source (optional)' } }, required: ['id', 'fn'] }), outputSchema: fromJsonSchema(CALL_OUT) },
    async ({ id, fn, args, source }) => { try { const r = await ready(id); return ok(await simulate(deps, r, fn, args ?? {}, source)); } catch (e) { return fail(e); } });
  server.registerTool('build', { description: 'Build an UNSIGNED transaction for a contract function; returns XDR for the user\'s wallet to sign. Only for contracts whose owner enabled read + write.', inputSchema: fromJsonSchema<{ id: string; fn: string; args?: Record<string, unknown>; source: string; fee?: string; timeout_s?: number }>({ type: 'object', properties: { id: { type: 'string' }, fn: { type: 'string' }, args: ARGS, source: { type: 'string', description: 'G… account that will sign' }, fee: { type: 'string' }, timeout_s: { type: 'integer' } }, required: ['id', 'fn', 'source'] }), outputSchema: fromJsonSchema(BUILD_OUT) },
    async ({ id, fn, args, source, fee, timeout_s }) => { try { const r = await ready(id); if (r.row.mcpScope !== 'rw') throw writeDisabled(id); return ok(await buildTx(deps, r, fn, args ?? {}, source, { fee, timeoutS: timeout_s })); } catch (e) { return fail(e); } });
  server.registerTool('submit', { description: 'Submit a signed transaction envelope (base64 XDR) for a contract and wait up to 30 s. Only for contracts whose owner enabled read + write.', inputSchema: fromJsonSchema<{ id: string; xdr: string }>({ type: 'object', properties: { id: { type: 'string' }, xdr: { type: 'string' } }, required: ['id', 'xdr'] }), outputSchema: fromJsonSchema(TX_OUT) },
    async ({ id, xdr }) => { try { const r = await ready(id); if (r.row.mcpScope !== 'rw') throw writeDisabled(id); return ok(await submitTx(deps, r, xdr)); } catch (e) { return fail(e); } });
  server.registerTool('get_tx', { description: 'Look up a submitted transaction by hash.', inputSchema: fromJsonSchema<{ hash: string; network: 'testnet' | 'mainnet' }>({ type: 'object', properties: { hash: { type: 'string' }, network: NET }, required: ['hash', 'network'] }), outputSchema: fromJsonSchema(TX_OUT) },
    async ({ hash, network }) => { try { return ok(await getTx(deps, network, hash)); } catch (e) { return fail(e); } });

  server.registerResource('contracts', 'sonata://contracts', { description: 'Registered contracts (JSON)', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ contracts: await list() }) }] }));
  server.registerResource('llms', new ResourceTemplate('sonata://c/{id}/llms.txt', { list: async () => ({ resources: (await list()).map((c) => ({ uri: `sonata://c/${c.id}/llms.txt`, name: c.name ?? c.id, mimeType: 'text/markdown' })) }) }), { description: 'AI-ready contract docs', mimeType: 'text/markdown' },
    async (uri, vars) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await docsOf(deps, String(vars.id)) }] }));
  return server;
}
```

`ready()` must return `{ row, model, spec }` — `Registry.ready` already does. If `registerResource`'s template overload has a different parameter order in the installed `@modelcontextprotocol/server` 2.x, follow its `.d.ts` and note it in the report.

`server/src/mcp/route.ts` — add a second `app.route` for `url: '/mcp'` with the same methods/config that builds `buildGlobalMcpServer(deps)` and connects a fresh `NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })` exactly like the existing handler (extract the transport dance into a local `serve(server, req, reply)` helper used by both routes).

- [ ] **Step 4: Run** — `cd server && npm test && npm run typecheck` → PASS.

- [ ] **Step 5: Commit** — `git add server/src/mcp server/test/mcp && git commit -m "server: global MCP endpoint with generic tools and resources" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

### Task 3: docs, README, server e2e

**Files:**
- Modify: `server/src/docs/llms.ts`, `server/test/docs/__snapshots__/llms.test.ts.snap`, `server/README.md`, `server/test/e2e/flow.test.ts`

- [ ] **Step 1:** In `llms.ts` change the MCP endpoint line to two lines: `` `MCP (all contracts): ${cfg.publicBaseUrl}/mcp — tools list_contracts, get_contract, call, build, submit` `` and `` `MCP (this contract): ${base}/mcp` ``. Update the snapshot deliberately (`npx vitest run test/docs -u` after eyeballing the diff).
- [ ] **Step 2:** README: endpoint row `ALL /mcp | Global MCP (all contracts) | Streamable HTTP`; replace the "MCP" section with: the global config + one-liner first, the tool table from the spec §4, the scope rule, then "Per-contract endpoint" as before.
- [ ] **Step 3:** e2e (`flow.test.ts`, after the MCP test): connect a `Client` to `${base}/mcp`; `list_contracts` contains `ID`; `call add(2,3)` → `"5"`; `build bump` with `source: G` after `PATCH mcp_scope=rw` (already set by the previous test — order-dependent; set it explicitly again) → xdr starts with `AAAA`.
- [ ] **Step 4:** `cd server && npm test && npm run typecheck && npm run test:e2e` → PASS. Commit `server: global MCP in llms.txt, README and e2e`.

---

### Task 4: site — global config everywhere

**Files:**
- Modify: `lib/api.js`, `components/workspace/Mcp.jsx`, `components/screens/Welcome.jsx`, `components/screens/Explorer.jsx`, `components/screens/ContractPublic.jsx`, `components/docs-data.js`, `e2e/site.spec.ts`
- Create: `test/site/mcp-tab.test.jsx`

- [ ] **Step 1: Failing test** — `test/site/mcp-tab.test.jsx` (mock `@/lib/sonata` with `{ useSonataUI: () => null, copyText: vi.fn(), download: vi.fn() }`, `afterEach(cleanup)`, `S` stub with `Numeral`, `Chip`, `Segmented`, `Button`, `DataTable: () => null`): render `<Mcp S={S} contract={c} id={c.id} refetch={() => {}} isOwner={false} />` with a 2-function contract whose `urls.mcp` is `https://api.test/c/CID/mcp`; assert the texts `All contracts (recommended)`, `This contract only`, `https://api.test/mcp`, `claude mcp add --transport http sonata https://api.test/mcp` and the scoped URL are all present; `API_URL` comes from `NEXT_PUBLIC_API_URL` — set `process.env.NEXT_PUBLIC_API_URL = 'https://api.test'` via `vi.stubEnv` before importing, or assert with `API_URL + '/mcp'` imported from `@/lib/api`.
- [ ] **Step 2:** `lib/api.js`: `export const mcpGlobalUrl = API_URL + '/mcp';` `export const mcpGlobalConfig = JSON.stringify({ mcpServers: { sonata: { url: mcpGlobalUrl, type: 'http' } } }, null, 2);` `export const mcpGlobalOneLiner = \`claude mcp add --transport http sonata ${mcpGlobalUrl}\`;`.
- [ ] **Step 3:** `Mcp.jsx`: the "Connect an agent" block becomes two labelled sections — `All contracts (recommended)` (global config + one-liner + Claude/Cursor/Codex copy buttons with the global config) and `This contract only` (today's scoped config + one-liner); add the sentence `The global endpoint exposes this contract through call / build / submit under the same scope.` under the scope control.
- [ ] **Step 4:** `Welcome.jsx`: `mcp` example = `${mcpGlobalConfig}\n\n# or\n${mcpGlobalOneLiner}` (no per-contract example); the MCP surface row's `endpoint` becomes `/mcp`. `Explorer.jsx`: under the page head add a strip `<div className="cta-band">` with "Connect an agent" + the global one-liner + `CopyButton`. `ContractPublic.jsx`: the "Connect an agent" box shows `mcpGlobalConfig` with a small line `Scoped endpoint: <c.urls.mcp>` beneath.
- [ ] **Step 5:** `docs-data.js` `mcp` page: intro "One endpoint for every registered contract."; sections: Connect (global config + one-liner), Workflow (p: list_contracts → get_contract → call/build → wallet signs → submit), Tools (kv of the eight tools with the rw note), Scoped endpoints (the per-contract config, one paragraph).
- [ ] **Step 6:** `e2e/site.spec.ts`: in the MCP tab step add `await expect(page.getByText('All contracts (recommended)')).toBeVisible();` and `await expect(page.getByText(\`${API}/mcp\`).first()).toBeVisible();`.
- [ ] **Step 7:** `npm test && npm run build` → PASS; commit `site: global MCP config on home, explorer, workspace, public page and docs`.

---

### Task 5: ship and verify (after PR #2 and this branch's PR merge)

- [ ] Open a PR `m4-global-mcp` → `main` (after PR #2 merges, rebase or retarget); merge; Dokploy autodeploys; `vercel deploy --prod --yes`.
- [ ] Smoke: `curl -s -X POST https://api.sonata.brages.uk/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"name":"[a-z_]*"'` → the eight names; then `claude mcp add --transport http sonata https://api.sonata.brages.uk/mcp` in a Claude Code session and ask it to list contracts and quote a Soroswap swap.

---

## Self-review

- Spec coverage: §3 endpoint → Task 2; §4 tools + §5 resources → Task 2; §6 handlers extraction → Task 1; §7 site → Task 4; §8 errors → Tasks 1–2 (`write_tools_disabled`, shared envelope); §9 tests → Tasks 1–4; §10 → Task 5.
- Placeholders: none — Task 3/4 steps that say "as before" refer to code that exists on the branch today.
- Consistency: `Ready` (Task 1) is what Task 2's `ready()` returns; `ok/fail/sig/simulate/buildTx/submitTx/getTx/searchFunctions/docsOf` names match between Tasks 1 and 2; `mcpGlobalUrl/Config/OneLiner` (Task 4 Step 2) are what Steps 3–5 use.
