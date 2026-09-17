import { describe, it, expect } from 'vitest';
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
    expect(list.json()).toEqual([{ id: FIXTURE_ID, name: 'KitchenSink', network: 'testnet', status: 'ready', fns: 15, updated_at: expect.any(String) }]);
    const one = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}` });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ id: FIXTURE_ID, mcp_scope: 'ro', status: 'ready', urls: { mcp: `https://api.sonata.test/c/${FIXTURE_ID}/mcp`, llms: `https://api.sonata.test/c/${FIXTURE_ID}/llms.txt`, openapi: `https://api.sonata.test/c/${FIXTURE_ID}/openapi.json` } });
    expect(one.json().functions).toHaveLength(15);
    expect((await app.inject({ method: 'GET', url: '/c/CNOPE' })).statusCode).toBe(404);
  });
  it('PATCH /c/:id updates name and scope, rejects bad scope', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const ok = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw', name: 'KS' } });
    expect(ok.json()).toMatchObject({ mcp_scope: 'rw', name: 'KS' });
    const bad = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'admin' } });
    expect(bad.statusCode).toBe(400);
  });
  it('GET /healthz reports db and networks', async () => {
    const { app } = await testApp();
    const h = await app.inject({ method: 'GET', url: '/healthz' });
    expect(h.json()).toEqual({ db: 'ok', networks: { testnet: 'ok', mainnet: 'ok' } });
  });
});
