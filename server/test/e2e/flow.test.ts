import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import pino from 'pino';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { loadConfig, PASSPHRASES } from '../../src/config.js';
import { RpcChain } from '../../src/chain/rpc.js';
import { MemoryStore } from '../../src/registry/store.js';
import { Registry } from '../../src/registry/registry.js';
import { llmsTxt } from '../../src/docs/llms.js';
import { openapi } from '../../src/docs/openapi.js';
import { buildApp } from '../../src/http/app.js';

if (existsSync('.env.test')) for (const l of readFileSync('.env.test', 'utf8').split('\n')) { const m = /^(\w+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
// Nothing here may run — or throw — at import time: `npm test` collects this file too, and the
// nightly job runs the suite with no E2E env at all (review finding M-b).
const ID = process.env.E2E_CONTRACT_ID ?? ''; const SECRET = process.env.E2E_SECRET_KEY ?? '';

let app: ReturnType<typeof buildApp>, base: string, kp: Keypair, G: string;
const setUp = async () => {
  kp = Keypair.fromSecret(SECRET); G = kp.publicKey();
  const cfg = loadConfig({ DATABASE_URL: 'postgres://unused', PUBLIC_BASE_URL: 'http://127.0.0.1' });
  const chain = new RpcChain(cfg); const store = new MemoryStore();
  const registry = new Registry({ store, chain, gen: { llmsTxt: (m) => llmsTxt(m, cfg), openapi: (m) => openapi(m, cfg) } });
  app = buildApp({ cfg, chain, registry, store, log: pino({ level: 'warn' }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  await app.inject({ method: 'POST', url: '/contracts', payload: { id: ID, network: 'testnet', name: 'KitchenSink' } });
  await registry.whenIdle();
};

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });

describe.skipIf(!ID || !SECRET)('e2e on testnet', () => {
  beforeAll(setUp, 60_000);
  afterAll(() => app.close());
  it('registered and ready', async () => {
    const st = await app.inject({ method: 'GET', url: `/c/${ID}/status` });
    expect(st.json(), JSON.stringify(st.json())).toMatchObject({ status: 'ready' });
  });
  it('/call simulates a read and a typed echo', async () => {
    const add = await post(`/c/${ID}/call/add`, { args: { a: '170141183460469231731687303715884105000', b: '727' } });
    expect(add.json()).toMatchObject({ result: '170141183460469231731687303715884105727', simulated: true, auth: [] });
    const map = await post(`/c/${ID}/call/echo_map`, { args: { m: { a: '1', b: '2' } } });
    expect(map.json().result).toEqual({ a: '1', b: '2' });
    const bytes = await post(`/c/${ID}/call/echo_bytes`, { args: { b: '0xcafe' } });
    expect(bytes.json().result).toBe('0xcafe');
  });
  it('/call maps a contract error to its name', async () => {
    const r = await post(`/c/${ID}/call/checked`, { args: { n: 101 } });
    expect(r.statusCode).toBe(422); expect(r.json()).toMatchObject({ error: 'TooBig', code: 1 });
  });
  it('/call on ping lists the signer; /tx builds; sign; /submit succeeds', async () => {
    const sim = await post(`/c/${ID}/call/ping`, { args: { who: G, n: 1 }, source: G });
    expect(sim.json().auth).toEqual([G]);
    const built = await post(`/c/${ID}/tx/ping`, { args: { who: G, n: 1 }, source: G });
    expect(built.statusCode, built.body).toBe(200);
    const tx = TransactionBuilder.fromXDR(built.json().xdr, PASSPHRASES.testnet);
    tx.sign(kp);
    const sub = await post(`/c/${ID}/submit`, { xdr: tx.toXDR() });
    expect(sub.json(), sub.body).toMatchObject({ status: 'success' });
    expect(sub.json().ledger).toBeGreaterThan(0);
  }, 90_000);
  it('MCP: call and build over Streamable HTTP', async () => {
    await app.inject({ method: 'PATCH', url: `/c/${ID}`, payload: { mcp_scope: 'rw' } });
    const client = new Client({ name: 'e2e', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/c/${ID}/mcp`)));
    const r = await client.callTool({ name: 'call_get_count', arguments: {} });
    expect(r.isError).toBeFalsy(); expect(typeof (r.structuredContent as any).result).toBe('number');
    const b = await client.callTool({ name: 'build_bump', arguments: { source: G } });
    expect((b.structuredContent as any).xdr).toMatch(/^AAAA/);
    await client.close();
  }, 60_000);
});
