import { describe, it, expect, vi } from 'vitest';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID } from '../fixtures/index.js';

describe('contracts routes', () => {
  it('POST /contracts validates and returns 202 queued; status becomes ready', async () => {
    const { app, registry } = await testApp();
    const bad = await app.inject({ method: 'POST', url: '/contracts', payload: { id: 'nope', network: 'testnet' } });
    expect(bad.statusCode).toBe(400); expect(bad.json().error).toBe('invalid_contract_id');
    const badNet = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'futurenet' } });
    expect(badNet.statusCode).toBe(400); expect(badNet.json().error).toBe('invalid_args');
    const res = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink' } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ id: FIXTURE_ID, network: 'testnet', status: 'queued' });
    await registry.whenIdle();
    const st = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/status` });
    expect(st.json()).toMatchObject({ status: 'ready' });
    expect(st.json().steps).toHaveLength(4);
  });
  it('GET /contracts lists; GET /c/:id returns model + settings + urls; 404 unknown', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const list = await app.inject({ method: 'GET', url: '/contracts' });
    expect(list.json()).toEqual([{ id: FIXTURE_ID, name: 'KitchenSink', network: 'testnet', status: 'ready', fns: 16, updated_at: expect.any(String) }]);
    const one = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}` });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ id: FIXTURE_ID, mcp_scope: 'ro', status: 'ready', urls: { mcp: `https://api.sonata.test/c/${FIXTURE_ID}/mcp`, llms: `https://api.sonata.test/c/${FIXTURE_ID}/llms.txt`, openapi: `https://api.sonata.test/c/${FIXTURE_ID}/openapi.json` } });
    expect(one.json().functions).toHaveLength(16);
    expect((await app.inject({ method: 'GET', url: '/c/CNOPE' })).statusCode).toBe(404);
  });
  it('PATCH /c/:id updates name and scope, rejects bad scope', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const ok = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw', name: 'KS' } });
    expect(ok.json()).toMatchObject({ mcp_scope: 'rw', name: 'KS' });
    const bad = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'admin' } });
    expect(bad.statusCode).toBe(400);
  });
  it('PATCH /c/:id regenerates llms.txt and openapi.json with the new name', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const patched = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { name: 'Renamed' } });
    expect(patched.json()).toMatchObject({ name: 'Renamed' });
    const llms = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/llms.txt` });
    expect(llms.body).toMatch(/^# Renamed/);
    const oa = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/openapi.json` });
    expect(oa.json().info.title).toContain('Renamed');
  });
  it('re-registering with a new name regenerates the docs even though the wasm is unchanged', async () => {
    const { app, registerFixture, registry } = await testApp(); await registerFixture();
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'Second' } });
    await registry.whenIdle();
    expect((await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/llms.txt` })).body).toMatch(/^# Second/);
    expect((await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/openapi.json` })).json().info.title).toContain('Second');
  });
  it('POST /contracts is 400 network_not_configured when the network has no RPC configured', async () => {
    const { app } = await testApp({ RPC_URL_MAINNET: undefined });
    const res = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'mainnet' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('network_not_configured');
  });
  it('GET /nope is 404 route_not_found', async () => {
    const { app } = await testApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('route_not_found');
  });
  it('GET /healthz reports db and networks', async () => {
    const { app } = await testApp();
    const h = await app.inject({ method: 'GET', url: '/healthz' });
    expect(h.json()).toEqual({ db: 'ok', networks: { testnet: 'ok', mainnet: 'ok' } });
  });
  it('GET /healthz stays 200 when a network is degraded, and says so in the body', async () => {
    // Liveness is about this process: a degraded upstream RPC must not make the platform recycle it.
    const { app, chain } = await testApp();
    chain.impl.health = async () => 'error';
    const h = await app.inject({ method: 'GET', url: '/healthz' });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toEqual({ db: 'ok', networks: { testnet: 'error', mainnet: 'error' } });
  });
  it('GET /healthz is 503 only when the database is unreachable, and probes with ping()', async () => {
    const { app, store } = await testApp();
    const listed = vi.spyOn(store, 'list');
    vi.spyOn(store, 'ping').mockRejectedValue(new Error('db is down'));
    const h = await app.inject({ method: 'GET', url: '/healthz' });
    expect(h.statusCode).toBe(503);
    expect(h.json()).toEqual({ db: 'error', networks: { testnet: 'ok', mainnet: 'ok' } });
    expect(listed).not.toHaveBeenCalled();
  });
});
