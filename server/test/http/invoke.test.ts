import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID } from '../fixtures/index.js';
import { ChainError } from '../../src/chain/errors.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const call = (app: any, fn: string, payload: unknown) => app.inject({ method: 'POST', url: `/c/${FIXTURE_ID}/call/${fn}`, payload });

describe('POST /call', () => {
  it('encodes args, simulates with the default source, decodes result and learns a read hint', async () => {
    const { app, chain, registerFixture, store } = await testApp(); await registerFixture();
    chain.impl.simulate = async () => ({ retval: nativeToScVal(12n, { type: 'i128' }), auth: [], ledger: 555, minResourceFee: '1', readWriteCount: 0, latencyMs: 7 });
    const res = await call(app, 'add', { args: { a: '5', b: 7 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: '12', simulated: true, latency_ms: 7, ledger: 555, auth: [] });
    const sim = chain.calls.find((c) => c.method === 'simulate')!;
    expect(sim.args[0]).toBe('testnet'); expect(sim.args[2]).toBe('add'); expect((sim.args[3] as xdr.ScVal[])[0].type).toBe('scvI128'); expect(sim.args[4]).toBe(G);
    expect(await store.getHints(FIXTURE_ID)).toEqual({ add: 'read' });
  });
  it('reports auth and learns a write hint when auth is required', async () => {
    const { app, chain, registerFixture, store } = await testApp(); await registerFixture();
    chain.impl.simulate = async () => ({ retval: xdr.ScVal.scvVoid(), auth: [G], ledger: 1, minResourceFee: '1', readWriteCount: 1, latencyMs: 1 });
    const res = await call(app, 'ping', { args: { who: G, n: 1 } });
    expect(res.json()).toMatchObject({ result: null, auth: [G] });
    expect(await store.getHints(FIXTURE_ID)).toEqual({ ping: 'write' });
  });
  it('400 invalid_args with a path; 404 unknown fn; 409 not ready; 400 network mismatch', async () => {
    const { app, registerFixture, registry } = await testApp();
    expect((await call(app, 'add', { args: {} })).statusCode).toBe(404);
    await registerFixture();
    const bad = await call(app, 'add', { args: { a: 'x', b: '1' } });
    expect(bad.statusCode).toBe(400); expect(bad.json()).toMatchObject({ error: 'invalid_args', details: { path: 'a' } });
    expect((await call(app, 'nope', { args: {} })).json()).toMatchObject({ error: 'function_not_found' });
    expect((await call(app, 'add', { args: { a: '1', b: '1' }, network: 'mainnet' })).json()).toMatchObject({ error: 'network_mismatch' });
    expect((await call(app, 'add', { a: '1' })).statusCode).toBe(400);
  });
  it('maps contract errors to spec names', async () => {
    const { app, chain, registerFixture } = await testApp(); await registerFixture();
    chain.impl.simulate = async () => { throw new ChainError(422, 'contract_error', 'contract returned error #1', { code: 1, details: { fn: 'checked' } }); };
    const res = await call(app, 'checked', { args: { n: 101 } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'TooBig', message: 'The number was too big.', code: 1, details: { fn: 'checked' } });
  });
});

describe('POST /tx, /submit, GET /tx', () => {
  it('requires source and returns xdr + auth', async () => {
    const { app, chain, registerFixture } = await testApp(); await registerFixture();
    const noSource = await app.inject({ method: 'POST', url: `/c/${FIXTURE_ID}/tx/ping`, payload: { args: { who: G, n: 1 } } });
    expect(noSource.statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url: `/c/${FIXTURE_ID}/tx/ping`, payload: { args: { who: G, n: 1 }, source: G, timeout_s: 60 } });
    expect(res.json()).toEqual({ xdr: 'AAAA', fee: '100', auth: [G], ledger: 100, expires_at: '2026-01-01T00:00:00.000Z' });
    expect(chain.calls.find((c) => c.method === 'buildTx')!.args[5]).toEqual({ fee: undefined, timeoutS: 60 });
  });
  it('submit waits and returns status; GET /tx polls', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const s = await app.inject({ method: 'POST', url: `/c/${FIXTURE_ID}/submit`, payload: { xdr: 'AAAA' } });
    expect(s.json()).toEqual({ hash: 'h', status: 'success', ledger: 101 });
    const g = await app.inject({ method: 'GET', url: '/tx/h?network=testnet' });
    expect(g.json()).toEqual({ hash: 'h', status: 'success', ledger: 101 });
    expect((await app.inject({ method: 'GET', url: '/tx/h' })).statusCode).toBe(400);
  });
});
