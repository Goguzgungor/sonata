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
    const { client, registry, store } = await connect();
    await registry.register(OTHER, 'mainnet', 'Pending', G);
    await registry.whenIdle();
    const all = text(await client.callTool({ name: 'list_contracts', arguments: {} }));
    expect(all.contracts.map((c: any) => c.id).sort()).toEqual([FIXTURE_ID, OTHER].sort());
    expect(all.contracts.find((c: any) => c.id === FIXTURE_ID)).toMatchObject({ name: 'KitchenSink', network: 'testnet', fns: 16, owner: expect.any(String) });
    const tn = text(await client.callTool({ name: 'list_contracts', arguments: { network: 'testnet' } }));
    expect(tn.contracts.map((c: any) => c.id)).toEqual([FIXTURE_ID]);
    const q = text(await client.callTool({ name: 'list_contracts', arguments: { q: 'kitchen' } }));
    expect(q.contracts.map((c: any) => c.id)).toEqual([FIXTURE_ID]);
    // A row that regresses to pending (e.g. a re-check) must disappear from the default listing again,
    // and only reappear with include_pending (review finding: gate/coverage gap).
    await store.update(FIXTURE_ID, { status: 'queued' });
    const hidden = text(await client.callTool({ name: 'list_contracts', arguments: {} }));
    expect(hidden.contracts.map((c: any) => c.id)).not.toContain(FIXTURE_ID);
    const shown = text(await client.callTool({ name: 'list_contracts', arguments: { include_pending: true } }));
    expect(shown.contracts.map((c: any) => c.id)).toContain(FIXTURE_ID);
  });
  it('get_contract returns schemas per function; search_functions and get_docs work; unknown id is an isError envelope', async () => {
    const { client } = await connect();
    const c = text(await client.callTool({ name: 'get_contract', arguments: { id: FIXTURE_ID } }));
    expect(c).toMatchObject({ id: FIXTURE_ID, network: 'testnet', mcp_scope: 'ro' });
    const add = c.functions.find((f: any) => f.name === 'add');
    expect(add.signature).toBe('add(a: i128, b: i128) → i128'); expect(add.input_schema.properties.a).toBeTruthy();
    const s = text(await client.callTool({ name: 'search_functions', arguments: { id: FIXTURE_ID, query: 'echo' } }));
    expect(s.functions.length).toBeGreaterThan(0); expect(s.functions.every((f: any) => f.name.toLowerCase().includes('echo') || f.doc.toLowerCase().includes('echo'))).toBe(true);
    const d = await client.callTool({ name: 'get_docs', arguments: { id: FIXTURE_ID } });
    expect((d.content as any)[0].text).toMatch(/^# KitchenSink/);
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
  it('build validates fee and timeout_s before any chain call (review finding I1)', async () => {
    const { client, chain, store } = await connect();
    await store.update(FIXTURE_ID, { mcpScope: 'rw' });
    const build = (extra: Record<string, unknown>) => client.callTool({ name: 'build', arguments: { id: FIXTURE_ID, fn: 'bump', args: {}, source: G, ...extra } });
    const negativeFee = await build({ fee: '-5' });
    expect(text(negativeFee)).toMatchObject({ error: 'invalid_args', details: { path: 'fee' } });
    const nonNumericFee = await build({ fee: 'abc' });
    expect(text(nonNumericFee)).toMatchObject({ error: 'invalid_args', details: { path: 'fee' } });
    const negativeTimeout = await build({ timeout_s: -10 });
    expect(text(negativeTimeout)).toMatchObject({ error: 'invalid_args', details: { path: 'timeout_s' } });
    const hugeTimeout = await build({ timeout_s: 1e15 });
    expect(text(hugeTimeout)).toMatchObject({ error: 'invalid_args', details: { path: 'timeout_s' } });
    expect(chain.calls.some((c) => c.method === 'buildTx')).toBe(false);
  });
  it('internal errors are logged and never echoed to the client (review finding I2)', async () => {
    const { client, chain } = await connect();
    chain.impl.simulate = async () => { throw new Error('connect ECONNREFUSED db:5432'); };
    const r = await client.callTool({ name: 'call', arguments: { id: FIXTURE_ID, fn: 'add', args: { a: '1', b: '2' } } });
    expect(r.isError).toBe(true);
    const body = text(r);
    expect(body).toEqual({ error: 'internal', message: 'internal error' });
    expect(body.message).not.toContain('ECONNREFUSED');
  });
  it('resources: the contract list and a contract\'s llms.txt', async () => {
    const { client } = await connect();
    const list = await client.readResource({ uri: 'sonata://contracts' });
    expect(JSON.parse((list.contents[0] as any).text).contracts[0].id).toBe(FIXTURE_ID);
    const doc = await client.readResource({ uri: `sonata://c/${FIXTURE_ID}/llms.txt` });
    expect((doc.contents[0] as any).text).toMatch(/^# KitchenSink/);
  });
  it('a resource read for an unknown contract comes back as envelope text, not a JSON-RPC error (review finding)', async () => {
    const { client } = await connect();
    const doc = await client.readResource({ uri: 'sonata://c/CNOPE/llms.txt' });
    expect((doc.contents[0] as any).text).toContain('contract_not_found');
  });
});
