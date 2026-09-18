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
import { loadAuthKeys } from '../../src/auth/keys.js';
import { ChallengeVerifier } from '../../src/auth/challenge.js';
import { buildApp } from '../../src/http/app.js';

if (existsSync('.env.test')) for (const l of readFileSync('.env.test', 'utf8').split('\n')) { const m = /^(\w+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
// Nothing here may run — or throw — at import time: `npm test` collects this file too, and the
// nightly job runs the suite with no E2E env at all (review finding M-b).
const ID = process.env.E2E_CONTRACT_ID ?? ''; const SECRET = process.env.E2E_SECRET_KEY ?? '';

let app: ReturnType<typeof buildApp>, base: string, kp: Keypair, G: string, token: string, registry: Registry;
const setUp = async () => {
  kp = Keypair.fromSecret(SECRET); G = kp.publicKey();
  const cfg = loadConfig({ DATABASE_URL: 'postgres://unused', PUBLIC_BASE_URL: 'http://127.0.0.1' });
  const chain = new RpcChain(cfg); const store = new MemoryStore();
  registry = new Registry({ store, chain, gen: { llmsTxt: (m) => llmsTxt(m, cfg), openapi: (m) => openapi(m, cfg) } });
  const keys = await loadAuthKeys(store, {});
  const challenge = { signing: keys.signing, homeDomain: cfg.authHomeDomain, webAuthDomain: '127.0.0.1' };
  const auth = { keys, challenge, verifier: new ChallengeVerifier(challenge) };
  app = buildApp({ cfg, chain, registry, store, log: pino({ level: 'warn' }), auth });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const ch = await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: G, network: 'testnet' } });
  const challengeTx = TransactionBuilder.fromXDR(ch.json().transaction, PASSPHRASES.testnet); challengeTx.sign(kp);
  const tok = await app.inject({ method: 'POST', url: '/auth/token', payload: { transaction: challengeTx.toXDR(), network: 'testnet' } });
  token = tok.json().token;
  await app.inject({ method: 'POST', url: '/contracts', payload: { id: ID, network: 'testnet', name: 'KitchenSink' }, headers: { authorization: `Bearer ${token}` } });
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
    await app.inject({ method: 'PATCH', url: `/c/${ID}`, payload: { mcp_scope: 'rw' }, headers: { authorization: `Bearer ${token}` } });
    const client = new Client({ name: 'e2e', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/c/${ID}/mcp`)));
    const r = await client.callTool({ name: 'call_get_count', arguments: {} });
    expect(r.isError).toBeFalsy(); expect(typeof (r.structuredContent as any).result).toBe('number');
    const b = await client.callTool({ name: 'build_bump', arguments: { source: G } });
    expect((b.structuredContent as any).xdr).toMatch(/^AAAA/);
    await client.close();
  }, 60_000);
  it('global MCP: list_contracts, call and build over Streamable HTTP', async () => {
    await app.inject({ method: 'PATCH', url: `/c/${ID}`, payload: { mcp_scope: 'rw' }, headers: { authorization: `Bearer ${token}` } });
    const client = new Client({ name: 'e2e', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const list = await client.callTool({ name: 'list_contracts', arguments: {} });
    expect((list.structuredContent as any).contracts.map((c: any) => c.id)).toContain(ID);
    const c = await client.callTool({ name: 'call', arguments: { id: ID, fn: 'add', args: { a: '2', b: '3' } } });
    expect(c.isError).toBeFalsy(); expect((c.structuredContent as any).result).toBe('5');
    const b = await client.callTool({ name: 'build', arguments: { id: ID, fn: 'bump', source: G } });
    expect((b.structuredContent as any).xdr).toMatch(/^AAAA/);
    await client.close();
  }, 60_000);
  it('a Stellar Asset Contract registers from the built-in spec and answers reads', async () => {
    const SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';   // testnet native XLM
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: SAC, network: 'testnet', name: 'XLM' }, headers: { authorization: `Bearer ${token}` } });
    await registry.whenIdle();
    expect((await app.inject({ method: 'GET', url: `/c/${SAC}/status` })).json()).toMatchObject({ status: 'ready' });
    const dec = await post(`/c/${SAC}/call/decimals`, { args: {} });
    expect(dec.json()).toMatchObject({ result: 7 });
    const bal = await post(`/c/${SAC}/call/balance`, { args: { id: G } });
    expect(bal.json().result).toMatch(/^\d+$/);
    const built = await post(`/c/${SAC}/tx/transfer`, { args: { from: G, to: G, amount: '1' }, source: G });
    expect(built.statusCode, built.body).toBe(200); expect(built.json().auth).toEqual([G]);
  }, 90_000);
});
