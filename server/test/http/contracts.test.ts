import { describe, it, expect, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { testApp, OWNER } from '../helpers/app.js';
import { signInAs, bearer } from '../helpers/session.js';
import { FIXTURE_ID } from '../fixtures/index.js';
import { sacUnsupported } from '../../src/chain/errors.js';

describe('contracts routes', () => {
  it('POST /contracts validates and returns 202 queued; status becomes ready', async () => {
    const { app, registry } = await testApp();
    const { token, address } = await signInAs(app, Keypair.random());
    const bad = await app.inject({ method: 'POST', url: '/contracts', payload: { id: 'nope', network: 'testnet' }, headers: bearer(token) });
    expect(bad.statusCode).toBe(400); expect(bad.json().error).toBe('invalid_contract_id');
    const badNet = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'futurenet' }, headers: bearer(token) });
    expect(badNet.statusCode).toBe(400); expect(badNet.json().error).toBe('invalid_args');
    const res = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink' }, headers: bearer(token) });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ id: FIXTURE_ID, network: 'testnet', status: 'queued', owner: address });
    await registry.whenIdle();
    const st = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/status` });
    expect(st.json()).toMatchObject({ status: 'ready' });
    expect(st.json().steps).toHaveLength(4);
  });
  it('registering a SAC fails the fetch step with a readable sac_unsupported error', async () => {
    const { app, chain, registry } = await testApp();
    const { token } = await signInAs(app, Keypair.random());
    chain.impl.getContractWasm = async () => { throw sacUnsupported(FIXTURE_ID); };
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet' }, headers: bearer(token) });
    await registry.whenIdle();
    const st = (await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/status` })).json();
    expect(st.status).toBe('failed');
    expect(st.steps[0]).toMatchObject({ name: 'fetch', status: 'failed', error: expect.stringContaining('Stellar Asset Contract') });
  });
  it('GET /contracts lists; GET /c/:id returns model + settings + urls; 404 unknown', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const list = await app.inject({ method: 'GET', url: '/contracts' });
    expect(list.json()).toEqual([{ id: FIXTURE_ID, name: 'KitchenSink', network: 'testnet', status: 'ready', fns: 16, owner: OWNER, created_at: expect.any(String), updated_at: expect.any(String) }]);
    const one = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}` });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ id: FIXTURE_ID, mcp_scope: 'ro', status: 'ready', urls: { mcp: `https://api.sonata.test/c/${FIXTURE_ID}/mcp`, llms: `https://api.sonata.test/c/${FIXTURE_ID}/llms.txt`, openapi: `https://api.sonata.test/c/${FIXTURE_ID}/openapi.json` } });
    expect(one.json().functions).toHaveLength(16);
    expect((await app.inject({ method: 'GET', url: '/c/CNOPE' })).statusCode).toBe(404);
  });
  it('PATCH /c/:id updates name and scope, rejects bad scope', async () => {
    const { app, registry } = await testApp();
    const { token } = await signInAs(app, Keypair.random());
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink' }, headers: bearer(token) });
    await registry.whenIdle();
    const ok = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw', name: 'KS' }, headers: bearer(token) });
    expect(ok.json()).toMatchObject({ mcp_scope: 'rw', name: 'KS' });
    const bad = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'admin' }, headers: bearer(token) });
    expect(bad.statusCode).toBe(400);
  });
  it('PATCH /c/:id regenerates llms.txt and openapi.json with the new name', async () => {
    const { app, registry } = await testApp();
    const { token } = await signInAs(app, Keypair.random());
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink' }, headers: bearer(token) });
    await registry.whenIdle();
    const patched = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { name: 'Renamed' }, headers: bearer(token) });
    expect(patched.json()).toMatchObject({ name: 'Renamed' });
    const llms = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/llms.txt` });
    expect(llms.body).toMatch(/^# Renamed/);
    const oa = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/openapi.json` });
    expect(oa.json().info.title).toContain('Renamed');
  });
  it('re-registering with a new name regenerates the docs even though the wasm is unchanged', async () => {
    const { app, registry } = await testApp();
    const { token } = await signInAs(app, Keypair.random());
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink' }, headers: bearer(token) });
    await registry.whenIdle();
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'Second' }, headers: bearer(token) });
    await registry.whenIdle();
    expect((await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/llms.txt` })).body).toMatch(/^# Second/);
    expect((await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/openapi.json` })).json().info.title).toContain('Second');
  });
  it('POST /contracts is 400 network_not_configured when the network has no RPC configured', async () => {
    const { app } = await testApp({ RPC_URL_MAINNET: undefined });
    const { token } = await signInAs(app, Keypair.random());
    const res = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'mainnet' }, headers: bearer(token) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('network_not_configured');
  });
  it('POST /contracts and PATCH /c/:id require a session', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const post = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet' } });
    expect(post.statusCode).toBe(401); expect(post.json().error).toBe('unauthorized');
    const patch = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { name: 'X' } });
    expect(patch.statusCode).toBe(401);
  });
  it('the registering wallet owns the contract; another wallet gets 403 not_owner', async () => {
    const { app, registry } = await testApp();
    const alice = await signInAs(app, Keypair.random()); const bob = await signInAs(app, Keypair.random());
    const res = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'KS' }, headers: bearer(alice.token) });
    expect(res.statusCode).toBe(202); await registry.whenIdle();
    expect((await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}` })).json().owner).toBe(alice.address);
    const again = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet' }, headers: bearer(bob.token) });
    expect(again.statusCode).toBe(403); expect(again.json()).toMatchObject({ error: 'not_owner', details: { owner: alice.address } });
    const patch = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw' }, headers: bearer(bob.token) });
    expect(patch.statusCode).toBe(403);
    const ok = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw' }, headers: bearer(alice.token) });
    expect(ok.statusCode).toBe(200); expect(ok.json().mcp_scope).toBe('rw');
    const list = await app.inject({ method: 'GET', url: '/contracts' });
    expect(list.json()[0]).toMatchObject({ id: FIXTURE_ID, owner: alice.address, created_at: expect.any(String) });
  });
  it('a legacy (ownerless) contract is claimed by the first wallet that registers or patches it', async () => {
    const { app, registry, store } = await testApp();
    await registry.register(FIXTURE_ID, 'testnet', 'Legacy', null); await registry.whenIdle();
    expect((await store.get(FIXTURE_ID))!.owner).toBeNull();
    const carol = await signInAs(app, Keypair.random());
    const patch = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { name: 'Claimed' }, headers: bearer(carol.token) });
    expect(patch.statusCode).toBe(200); expect(patch.json()).toMatchObject({ name: 'Claimed', owner: carol.address });
    const dave = await signInAs(app, Keypair.random());
    const daveTry = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { name: 'Nope' }, headers: bearer(dave.token) });
    expect(daveTry.statusCode).toBe(403); expect(daveTry.json()).toMatchObject({ error: 'not_owner', details: { owner: carol.address } });
  });
  it('POST /contracts on a legacy (ownerless) row claims it and reports the new owner in the 202 body', async () => {
    const { app, registry, store } = await testApp();
    await registry.register(FIXTURE_ID, 'testnet', 'Legacy', null); await registry.whenIdle();
    expect((await store.get(FIXTURE_ID))!.owner).toBeNull();
    const erin = await signInAs(app, Keypair.random());
    const res = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet' }, headers: bearer(erin.token) });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ id: FIXTURE_ID, owner: erin.address });
    expect((await store.get(FIXTURE_ID))!.owner).toBe(erin.address);
  });
  it('GET /contracts?owner=me lists only the caller\'s contracts and needs a session', async () => {
    const { app, registry } = await testApp();
    const alice = await signInAs(app, Keypair.random());
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet' }, headers: bearer(alice.token) });
    await registry.register('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', 'testnet', 'Other', 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H');
    await registry.whenIdle();
    expect((await app.inject({ method: 'GET', url: '/contracts' })).json()).toHaveLength(2);
    const mine = await app.inject({ method: 'GET', url: '/contracts?owner=me', headers: bearer(alice.token) });
    expect(mine.json().map((c: any) => c.id)).toEqual([FIXTURE_ID]);
    expect((await app.inject({ method: 'GET', url: '/contracts?owner=me' })).statusCode).toBe(401);
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
