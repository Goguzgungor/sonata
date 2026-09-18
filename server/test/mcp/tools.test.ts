import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID } from '../fixtures/index.js';
import { buildMcpServer } from '../../src/mcp/tools.js';
import { ChainError } from '../../src/chain/errors.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

async function connect(scope: 'ro' | 'rw') {
  const t = await testApp(); await t.registerFixture();
  const { model, spec } = await t.registry.ready(FIXTURE_ID);
  const deps = { cfg: t.cfg, chain: t.chain, registry: t.registry, store: t.store, log: t.app.log as any };
  const server = buildMcpServer(model, spec, scope, deps);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await server.connect(st); await client.connect(ct);
  return { ...t, client };
}

describe('buildMcpServer', () => {
  it('read-only lists call_* + search + docs only; rw adds build_* and submit', async () => {
    const ro = await connect('ro');
    const names = (await ro.client.listTools()).tools.map((t) => t.name).sort();
    expect(names.filter((n) => n.startsWith('call_'))).toHaveLength(16);
    expect(names).toContain('search_functions'); expect(names).toContain('get_docs');
    expect(names.some((n) => n.startsWith('build_'))).toBe(false); expect(names).not.toContain('submit_transaction');
    const rw = await connect('rw');
    const rwNames = (await rw.client.listTools()).tools.map((t) => t.name);
    expect(rwNames.filter((n) => n.startsWith('build_'))).toHaveLength(16); expect(rwNames).toContain('submit_transaction');
  });
  it('tool descriptions carry doc + signature, input schema is the args schema plus source', async () => {
    const { client } = await connect('ro');
    const add = (await client.listTools()).tools.find((t) => t.name === 'call_add')!;
    expect(add.description).toContain('Returns the sum of two i128 values.');
    expect(add.description).toContain('add(a: i128, b: i128) → i128');
    expect((add.inputSchema as any).properties.a).toBeTruthy(); expect((add.inputSchema as any).properties.source).toBeTruthy();
  });
  it('call_* returns text + structuredContent', async () => {
    const { client, chain } = await connect('ro');
    chain.impl.simulate = async () => ({ retval: nativeToScVal(3n, { type: 'i128' }), auth: [], ledger: 9, minResourceFee: '1', readWriteCount: 0, latencyMs: 2 });
    const r = await client.callTool({ name: 'call_add', arguments: { a: '1', b: '2' } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ result: '3', simulated: true, latency_ms: 2, ledger: 9, auth: [] });
    expect(JSON.parse((r.content as any)[0].text)).toEqual(r.structuredContent);
  });
  it('contract errors come back as isError with the envelope', async () => {
    const { client, chain } = await connect('ro');
    chain.impl.simulate = async () => { throw new ChainError(422, 'contract_error', 'x', { code: 2 }); };
    const r = await client.callTool({ name: 'call_checked', arguments: { n: 5 } });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content as any)[0].text)).toMatchObject({ error: 'Forbidden', code: 2 });
  });
  it('build_* and submit work in rw', async () => {
    const { client } = await connect('rw');
    const build = (await client.listTools()).tools.find((t) => t.name === 'build_ping')!;
    expect(build.description).toContain('Requires `who` to authorize and emits Pinged.');
    expect(build.description).toContain('Kind: ');
    const b = await client.callTool({ name: 'build_ping', arguments: { who: G, n: 1, source: G } });
    expect(b.structuredContent).toMatchObject({ xdr: 'AAAA', auth: [G] });
    const s = await client.callTool({ name: 'submit_transaction', arguments: { xdr: 'AAAA' } });
    expect(s.structuredContent).toMatchObject({ hash: 'h', status: 'success' });
  });
  it('rejects a malformed source with an invalid_args envelope, before any RPC call', async () => {
    const { client, chain } = await connect('rw');
    const b = await client.callTool({ name: 'build_ping', arguments: { who: G, n: 1, source: 'x' } });
    expect(b.isError).toBe(true);
    expect(JSON.parse((b.content as any)[0].text)).toMatchObject({ error: 'invalid_args', details: { path: 'source' } });
    const c = await client.callTool({ name: 'call_ping', arguments: { who: G, n: 1, source: 'x' } });
    expect(c.isError).toBe(true);
    expect(JSON.parse((c.content as any)[0].text)).toMatchObject({ error: 'invalid_args', details: { path: 'source' } });
    expect(chain.calls.some((x) => x.method === 'buildTx' || x.method === 'simulate')).toBe(false);
  });
  it('search_functions and get_docs', async () => {
    const { client } = await connect('ro');
    const s = await client.callTool({ name: 'search_functions', arguments: { query: 'echo' } });
    expect((s.structuredContent as any).functions.map((f: any) => f.name)).toEqual(['echo_bytes', 'echo_hash', 'echo_level', 'echo_map', 'echo_nested', 'echo_pair', 'echo_shape', 'maybe', 'text', 'tuple']);
    const d = await client.callTool({ name: 'get_docs', arguments: {} });
    expect((d.content as any)[0].text).toMatch(/^# KitchenSink/);
    expect((d.structuredContent as any).text).toMatch(/^# KitchenSink/);
  });
});
